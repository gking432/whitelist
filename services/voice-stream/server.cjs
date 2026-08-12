const { createHmac, timingSafeEqual } = require("node:crypto");
const http = require("node:http");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;
const {
  functionCallOutput,
  functionCallsFromResponse,
  initialResponse,
  realtimeSessionUpdate,
  truncateAssistantItem,
  twilioClear,
  twilioMark,
  twilioMedia,
} = require("./protocol.cjs");

const port = Number(process.env.PORT || process.env.VOICE_STREAM_PORT || 8081);
const appUrl = (process.env.NORTHSTAR_APP_URL || "").replace(/\/$/, "");
const apiKey = process.env.OPENAI_API_KEY || "";
const sharedSecret = process.env.VOICE_STREAM_SHARED_SECRET || "";
const transcriptionModel =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
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
  if (!callSessionId || !token || !/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(sessionToken(callSessionId), "hex");
  const actual = Buffer.from(token, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signedHeaders(body) {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", sharedSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "x-northstar-timestamp": timestamp,
    "x-northstar-signature": signature,
  };
}

async function postSigned(path, input, maxAttempts = 4) {
  const body = JSON.stringify(input);
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}${path}`, {
        method: "POST",
        headers: signedHeaders(body),
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (response.ok) return data;
      lastError = new Error(data.error || `${path} failed (${response.status}).`);

      if (response.status < 500 && response.status !== 409) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt + 1 < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(4_000, 400 * 2 ** attempt)),
      );
    }
  }

  throw lastError || new Error(`${path} failed.`);
}

function createDeliveryTracker() {
  const pending = new Set();

  return {
    deliver(path, input) {
      const delivery = postSigned(path, input).catch((error) => {
        console.error(`${path} delivery failed:`, error.message);
      });
      pending.add(delivery);
      delivery.finally(() => pending.delete(delivery));
      return delivery;
    },
    async settle() {
      await Promise.allSettled([...pending]);
    },
  };
}

function realtimeUrl(model) {
  const configured = process.env.OPENAI_REALTIME_WS_URL?.trim();

  if (configured && process.env.VOICE_STREAM_TEST_MODE === "1") {
    const url = new URL(configured);
    url.searchParams.set("model", model);
    return url.toString();
  }

  return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
}

function createTranscriber(callSessionId, track, deliveries) {
  const pendingAudio = [];
  const socket = new WebSocket(
    realtimeUrl(process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-live-transcribe"),
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": sessionToken(callSessionId),
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
                model: process.env.OPENAI_TRANSCRIPTION_MODEL ||
                  "gpt-live-transcribe",
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
      socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
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
      deliveries.deliver("/api/voice/provider/transcript", {
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
        socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
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

async function createAiBridge(input) {
  const bootstrap = await postSigned("/api/voice/provider/control", {
    action: "bootstrap",
    call_session_id: input.callSessionId,
  });
  const pendingAudio = [];
  const pendingMarks = new Set();
  let latestMediaTimestamp = 0;
  let responseStartTimestamp = null;
  let lastAssistantItemId = null;
  let markCounter = 0;
  let responseActive = false;
  let toolQueue = Promise.resolve();
  let closed = false;
  let failed = false;

  const openai = new WebSocket(realtimeUrl(bootstrap.model), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": sessionToken(input.callSessionId),
    },
  });

  function sendOpenAI(event) {
    if (openai.readyState === WebSocket.OPEN) {
      openai.send(JSON.stringify(event));
    }
  }

  function sendTwilio(event) {
    if (input.twilio.readyState === WebSocket.OPEN) {
      input.twilio.send(JSON.stringify(event));
    }
  }

  function failBridge(reason) {
    if (closed || failed) return;
    failed = true;
    console.error("AI voice bridge failed:", reason);
    if (input.twilio.readyState === WebSocket.OPEN) {
      input.twilio.close(1011, "AI stream unavailable");
    }
  }

  function interruptAssistant() {
    if (!input.streamSid || pendingMarks.size === 0) return;

    sendTwilio(twilioClear(input.streamSid));

    if (lastAssistantItemId && responseStartTimestamp !== null) {
      sendOpenAI(
        truncateAssistantItem(
          lastAssistantItemId,
          latestMediaTimestamp - responseStartTimestamp,
        ),
      );
    }

    if (responseActive) sendOpenAI({ type: "response.cancel" });
    pendingMarks.clear();
    lastAssistantItemId = null;
    responseStartTimestamp = null;
    responseActive = false;
  }

  async function executeFunctionCalls(calls) {
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = {};
      }

      let output;
      try {
        output = await postSigned("/api/voice/provider/control", {
          action: "tool",
          call_session_id: input.callSessionId,
          call_id: call.callId,
          name: call.name,
          arguments: args,
        });
      } catch (error) {
        output = { result: { error: error.message } };
      }

      sendOpenAI(functionCallOutput(call.callId, output.result || output));
    }

    if (calls.length > 0) sendOpenAI({ type: "response.create" });
  }

  openai.on("open", () => {
    sendOpenAI(
      realtimeSessionUpdate({
        instructions: bootstrap.instructions,
        model: bootstrap.model,
        voice: bootstrap.voice,
        transcriptionModel:
          bootstrap.transcription_model || transcriptionModel,
        tools: Array.isArray(bootstrap.tools) ? bootstrap.tools : [],
      }),
    );
    sendOpenAI(initialResponse(bootstrap.initial_instruction));

    for (const audio of pendingAudio.splice(0)) {
      sendOpenAI({ type: "input_audio_buffer.append", audio });
    }
  });

  openai.on("message", (message) => {
    let event;
    try {
      event = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (event.type === "response.created") responseActive = true;

    if (
      event.type === "response.output_audio.delta" &&
      typeof event.delta === "string" &&
      input.streamSid
    ) {
      responseStartTimestamp ??= latestMediaTimestamp;
      if (typeof event.item_id === "string") lastAssistantItemId = event.item_id;
      const markName = `audio-${++markCounter}`;
      pendingMarks.add(markName);
      sendTwilio(twilioMedia(input.streamSid, event.delta));
      sendTwilio(twilioMark(input.streamSid, markName));
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      input.deliveries.deliver("/api/voice/provider/transcript", {
        call_session_id: input.callSessionId,
        role: "caller",
        text: event.transcript.trim(),
        source_event_id: `caller:${event.item_id || Date.now()}`,
        occurred_at: new Date().toISOString(),
      });
    }

    if (
      event.type === "response.output_audio_transcript.done" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      input.deliveries.deliver("/api/voice/provider/transcript", {
        call_session_id: input.callSessionId,
        role: "ai_assistant",
        text: event.transcript.trim(),
        source_event_id: `assistant:${event.item_id || Date.now()}`,
        occurred_at: new Date().toISOString(),
      });
    }

    if (event.type === "input_audio_buffer.speech_started") {
      interruptAssistant();
    }

    if (event.type === "response.done") {
      responseActive = false;
      const calls = functionCallsFromResponse(event);
      if (calls.length > 0) {
        toolQueue = toolQueue.then(() => executeFunctionCalls(calls));
      }
    }

    if (event.type === "error") {
      const code = event.error?.code || "";
      if (code !== "response_cancel_not_active") {
        failBridge(event.error?.message || "OpenAI realtime error");
      }
    }
  });

  openai.on("error", (error) => {
    failBridge(error.message);
  });

  openai.on("close", () => {
    if (!closed) failBridge("OpenAI realtime connection closed");
  });

  return {
    append(audio, timestamp) {
      const parsedTimestamp = Number(timestamp);
      if (Number.isFinite(parsedTimestamp)) latestMediaTimestamp = parsedTimestamp;

      if (openai.readyState === WebSocket.OPEN) {
        sendOpenAI({ type: "input_audio_buffer.append", audio });
      } else if (pendingAudio.length < 500) {
        pendingAudio.push(audio);
      }
    },
    mark(name) {
      if (typeof name === "string") pendingMarks.delete(name);
    },
    async close() {
      closed = true;
      await toolQueue.catch(() => {});
      if (openai.readyState === WebSocket.OPEN) openai.close(1000);
      else if (openai.readyState === WebSocket.CONNECTING) openai.terminate();
    },
  };
}

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ ok: true, release, modes: ["staff_assisted", "ai_answered"] }),
    );
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
  let mode = "staff_assisted";
  let streamSid = null;
  let aiBridge = null;
  let bridgeStarting = null;
  let finalized = false;
  const transcribers = new Map();
  const deliveries = createDeliveryTracker();
  const queuedAiMedia = [];

  async function startAiBridge() {
    if (!callSessionId || !streamSid || bridgeStarting || aiBridge) return;
    bridgeStarting = createAiBridge({
      callSessionId,
      streamSid,
      twilio,
      deliveries,
    });

    try {
      aiBridge = await bridgeStarting;
      for (const media of queuedAiMedia.splice(0)) {
        aiBridge.append(media.payload, media.timestamp);
      }
    } catch (error) {
      console.error("AI voice bootstrap failed:", error.message);
      if (twilio.readyState === WebSocket.OPEN) {
        twilio.close(1011, "AI stream unavailable");
      }
    }
  }

  async function finalize() {
    if (finalized) return;
    finalized = true;
    await aiBridge?.close();
    for (const transcriber of transcribers.values()) transcriber.close();
    transcribers.clear();
    await deliveries.settle();

  }

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
      mode = parameters.mode === "ai_answered" ? "ai_answered" : "staff_assisted";
      streamSid = event.start?.streamSid || event.streamSid || null;
      authenticated = validSessionToken(callSessionId, parameters.streamToken);

      if (!authenticated || !streamSid) {
        twilio.close(1008, "Unauthorized stream");
      } else if (mode === "ai_answered") {
        void startAiBridge();
      }
      return;
    }

    if (!authenticated || !callSessionId) return;

    if (event.event === "media" && event.media?.payload) {
      if (mode === "ai_answered") {
        if (aiBridge) {
          aiBridge.append(event.media.payload, event.media.timestamp);
        } else if (queuedAiMedia.length < 500) {
          queuedAiMedia.push({
            payload: event.media.payload,
            timestamp: event.media.timestamp,
          });
        }
        return;
      }

      const track = event.media.track === "outbound" ? "outbound" : "inbound";
      let transcriber = transcribers.get(track);

      if (!transcriber) {
        transcriber = createTranscriber(callSessionId, track, deliveries);
        transcribers.set(track, transcriber);
      }

      transcriber.append(event.media.payload);
    }

    if (event.event === "mark" && mode === "ai_answered") {
      aiBridge?.mark(event.mark?.name);
    }

    if (event.event === "stop") void finalize();
  });

  twilio.on("close", () => void finalize());
  twilio.on("error", (error) => {
    console.error("Twilio media stream error:", error.message);
  });
});

server.listen(port, () => {
  console.log(`Northstar voice stream listening on :${port}`);
});
