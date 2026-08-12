const { createHmac, timingSafeEqual } = require("node:crypto");
const http = require("node:http");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

const port = Number(process.env.PORT || process.env.VOICE_STREAM_PORT || 8081);
const appUrl = (process.env.NORTHSTAR_APP_URL || "").replace(/\/$/, "");
const apiKey = process.env.OPENAI_API_KEY || "";
const sharedSecret = process.env.VOICE_STREAM_SHARED_SECRET || "";
const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-live-transcribe";
const release = (() => {
  const value = (
    process.env.RENDER_GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.RELEASE_SHA ||
    ""
  )
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(value) ? value : null;
})();

if (!appUrl || !apiKey || !sharedSecret) {
  console.error(
    "NORTHSTAR_APP_URL, OPENAI_API_KEY, and VOICE_STREAM_SHARED_SECRET are required.",
  );
  process.exit(1);
}

function sessionToken(callSessionId) {
  return createHmac("sha256", sharedSecret)
    .update(callSessionId)
    .digest("hex");
}

function validSessionToken(callSessionId, token) {
  if (!callSessionId || !token) return false;
  const expected = Buffer.from(sessionToken(callSessionId), "hex");
  const actual = Buffer.from(token, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function sendTranscript(input, attempt = 0) {
  const body = JSON.stringify(input);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", sharedSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  try {
    const response = await fetch(`${appUrl}/api/voice/provider/transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-northstar-timestamp": timestamp,
        "x-northstar-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok && attempt < 3) {
      setTimeout(() => void sendTranscript(input, attempt + 1), 500 * 2 ** attempt);
    }
  } catch (error) {
    if (attempt < 3) {
      setTimeout(() => void sendTranscript(input, attempt + 1), 500 * 2 ** attempt);
    } else {
      console.error("Transcript delivery failed:", error);
    }
  }
}

function createTranscriber(callSessionId, track) {
  const pendingAudio = [];
  const socket = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": createHmac("sha256", sharedSecret)
          .update(callSessionId)
          .digest("hex"),
      },
    },
  );

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: {
                model,
                languages: ["en"],
                delay: "low",
                prompt:
                  "A customer service and scheduling call. Preserve names, phone numbers, email addresses, street addresses, dates, and times.",
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.45,
                prefix_padding_ms: 300,
                silence_duration_ms: 600,
              },
            },
          },
        },
      }),
    );

    for (const audio of pendingAudio.splice(0)) {
      socket.send(
        JSON.stringify({ type: "input_audio_buffer.append", audio }),
      );
    }
  });

  socket.on("message", (message) => {
    let event;

    try {
      event = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      void sendTranscript({
        call_session_id: callSessionId,
        role: track === "inbound" ? "caller" : "staff",
        text: event.transcript.trim(),
        source_event_id: `${track}:${event.item_id || Date.now()}`,
        occurred_at: new Date().toISOString(),
      });
    }

    if (event.type === "error") {
      console.error("OpenAI transcription error:", event.error?.message || event);
    }
  });

  socket.on("error", (error) => {
    console.error(`OpenAI ${track} stream error:`, error.message);
  });

  return {
    append(audio) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "input_audio_buffer.append", audio }),
        );
      } else if (pendingAudio.length < 500) {
        pendingAudio.push(audio);
      }
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    },
  };
}

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, release }));
    return;
  }

  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/twilio") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (client) => {
    wss.emit("connection", client, request);
  });
});

wss.on("connection", (twilio) => {
  let callSessionId = null;
  let authenticated = false;
  const transcribers = new Map();

  twilio.on("message", (message) => {
    let event;

    try {
      event = JSON.parse(message.toString());
    } catch {
      twilio.close(1003, "Invalid event");
      return;
    }

    if (event.event === "start") {
      const parameters = event.start?.customParameters || {};
      callSessionId = parameters.callSessionId || null;
      authenticated = validSessionToken(
        callSessionId,
        parameters.streamToken,
      );

      if (!authenticated) twilio.close(1008, "Unauthorized stream");
      return;
    }

    if (!authenticated || !callSessionId) return;

    if (event.event === "media" && event.media?.payload) {
      const track = event.media.track === "outbound" ? "outbound" : "inbound";
      let transcriber = transcribers.get(track);

      if (!transcriber) {
        transcriber = createTranscriber(callSessionId, track);
        transcribers.set(track, transcriber);
      }

      transcriber.append(event.media.payload);
    }

    if (event.event === "stop") {
      setTimeout(() => {
        for (const transcriber of transcribers.values()) transcriber.close();
        transcribers.clear();
      }, 1_500);
    }
  });

  twilio.on("close", () => {
    setTimeout(() => {
      for (const transcriber of transcribers.values()) transcriber.close();
      transcribers.clear();
    }, 1_500);
  });
});

server.listen(port, () => {
  console.log(`Northstar voice stream listening on :${port}`);
});
