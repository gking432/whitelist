import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import WebSocket, { WebSocketServer } from "ws";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        reject(new Error("No port."));
      else resolve(address.port);
    });
  });
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        reject(new Error("No port."));
      else resolve(address.port);
    });
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function stopChild(child: ChildProcess | null) {
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

test("voice gateway bridges Twilio and OpenAI with tools, transcripts, and barge-in", async () => {
  const secret = "bridge-test-secret";
  const callSessionId = "11111111-1111-4111-8111-111111111111";
  const receivedControl: Record<string, any>[] = [];
  const receivedTranscripts: Record<string, any>[] = [];
  const openAiEvents: Record<string, any>[] = [];
  const twilioEvents: Record<string, any>[] = [];
  let gateway: ChildProcess | null = null;

  const appServer = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const timestamp = request.headers["x-northstar-timestamp"] as string;
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    assert.equal(request.headers["x-northstar-signature"], expected);
    const input = JSON.parse(body);

    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/voice/provider/transcript") {
      receivedTranscripts.push(input);
      response.end('{"accepted":true}');
      return;
    }

    assert.equal(request.url, "/api/voice/provider/control");
    receivedControl.push(input);
    if (input.action === "bootstrap") {
      response.end(
        JSON.stringify({
          instructions: "Answer for Acme Home Services.",
          initial_instruction: "Greet the caller.",
          model: "gpt-realtime-test",
          voice: "marin",
          transcription_model: "gpt-4o-mini-transcribe",
          tools: [{ type: "function", name: "propose_slots", parameters: {} }],
        }),
      );
    } else if (input.action === "tool") {
      response.end(
        JSON.stringify({
          result:
            input.name === "end_call"
              ? { status: "ending" }
              : { slots: [{ start_iso: "2026-08-14T14:00:00.000Z" }] },
          end_call: input.name === "end_call",
        }),
      );
    } else if (input.action === "end") {
      response.end('{"ended":true}');
    }
  });
  const openAiServer = http.createServer();
  const openAiWss = new WebSocketServer({ server: openAiServer });

  openAiWss.on("connection", (socket, request) => {
    assert.match(request.headers.authorization ?? "", /^Bearer /);
    socket.on("message", (message) => {
      const event = JSON.parse(message.toString());
      openAiEvents.push(event);

      if (
        event.type === "response.create" &&
        openAiEvents.filter((item) => item.type === "response.create")
          .length === 1
      ) {
        socket.send(JSON.stringify({ type: "response.created" }));
        socket.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            item_id: "assistant-item-1",
            delta: "bXVsdWxhdw==",
          }),
        );
        socket.send(
          JSON.stringify({
            type: "response.output_audio_transcript.done",
            item_id: "assistant-item-1",
            transcript: "Hi, how can I help?",
          }),
        );
        socket.send(
          JSON.stringify({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: "caller-item-1",
            transcript: "Friday morning works.",
          }),
        );
        socket.send(
          JSON.stringify({ type: "input_audio_buffer.speech_started" }),
        );
        socket.send(
          JSON.stringify({
            type: "response.done",
            response: {
              output: [
                {
                  type: "function_call",
                  call_id: "tool-call-1",
                  name: "propose_slots",
                  arguments: '{"preference_text":"Friday morning"}',
                },
              ],
            },
          }),
        );
      } else if (
        event.type === "response.create" &&
        openAiEvents.filter((item) => item.type === "response.create")
          .length === 2
      ) {
        socket.send(JSON.stringify({ type: "response.created" }));
        socket.send(
          JSON.stringify({
            type: "response.done",
            response: {
              output: [
                {
                  type: "function_call",
                  call_id: "tool-call-2",
                  name: "end_call",
                  arguments: "{}",
                },
              ],
            },
          }),
        );
      } else if (
        event.type === "response.create" &&
        openAiEvents.filter((item) => item.type === "response.create")
          .length === 3
      ) {
        socket.send(JSON.stringify({ type: "response.created" }));
        socket.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            item_id: "assistant-item-goodbye",
            delta: "Z29vZGJ5ZQ==",
          }),
        );
        socket.send(
          JSON.stringify({
            type: "response.done",
            response: { output: [] },
          }),
        );
      }
    });
  });

  const [appPort, openAiPort, gatewayPort] = await Promise.all([
    listen(appServer),
    listen(openAiServer),
    freePort(),
  ]);

  try {
    gateway = spawn(process.execPath, ["services/voice-stream/server.cjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(gatewayPort),
        NORTHSTAR_APP_URL: `http://127.0.0.1:${appPort}`,
        OPENAI_API_KEY: "bridge-test-key",
        VOICE_STREAM_SHARED_SECRET: secret,
        VOICE_STREAM_TEST_MODE: "1",
        OPENAI_REALTIME_WS_URL: `ws://127.0.0.1:${openAiPort}/realtime`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let gatewayLog = "";
    gateway.stdout?.on("data", (chunk) => (gatewayLog += chunk.toString()));
    gateway.stderr?.on("data", (chunk) => (gatewayLog += chunk.toString()));
    await waitFor(() => gatewayLog.includes("listening"), "gateway startup");

    const twilio = new WebSocket(`ws://127.0.0.1:${gatewayPort}/twilio`);
    await new Promise<void>((resolve, reject) => {
      twilio.once("open", resolve);
      twilio.once("error", reject);
    });
    twilio.on("message", (message) => {
      twilioEvents.push(JSON.parse(message.toString()));
    });
    const token = createHmac("sha256", secret)
      .update(callSessionId)
      .digest("hex");
    twilio.send(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZ_TEST_STREAM",
          customParameters: {
            callSessionId,
            streamToken: token,
            mode: "ai_answered",
          },
        },
      }),
    );
    twilio.send(
      JSON.stringify({
        event: "media",
        streamSid: "MZ_TEST_STREAM",
        media: { track: "inbound", timestamp: "250", payload: "Y2FsbGVy" },
      }),
    );

    await waitFor(
      () => twilioEvents.some((event) => event.event === "media"),
      "AI audio to Twilio",
    );
    await waitFor(
      () => twilioEvents.some((event) => event.event === "clear"),
      "barge-in clear",
    );
    await waitFor(
      () =>
        openAiEvents.some((event) => event.type === "conversation.item.create"),
      "tool result",
    );
    await waitFor(() => receivedTranscripts.length === 2, "transcripts");
    await waitFor(
      () => twilioEvents.some((event) => event.mark?.name === "audio-2"),
      "final assistant audio mark",
    );
    twilio.send(
      JSON.stringify({
        event: "mark",
        streamSid: "MZ_TEST_STREAM",
        mark: { name: "audio-2" },
      }),
    );
    await waitFor(
      () => receivedControl.some((item) => item.action === "end"),
      "signed carrier hangup",
    );

    assert.ok(
      openAiEvents.some(
        (event) =>
          event.type === "session.update" &&
          event.session.audio.input.format.type === "audio/pcmu" &&
          event.session.audio.output.format.type === "audio/pcmu",
      ),
    );
    assert.ok(
      openAiEvents.some(
        (event) =>
          event.type === "input_audio_buffer.append" &&
          event.audio === "Y2FsbGVy",
      ),
    );
    assert.ok(
      openAiEvents.some(
        (event) =>
          event.type === "conversation.item.truncate" &&
          event.item_id === "assistant-item-1",
      ),
    );
    assert.deepEqual(receivedTranscripts.map((item) => item.role).sort(), [
      "ai_assistant",
      "caller",
    ]);
    assert.ok(
      receivedControl.some(
        (item) => item.action === "tool" && item.call_id === "tool-call-1",
      ),
    );
    assert.ok(
      receivedControl.some(
        (item) => item.action === "tool" && item.name === "end_call",
      ),
    );

    twilio.send(JSON.stringify({ event: "stop", streamSid: "MZ_TEST_STREAM" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      receivedControl.some((item) => item.action === "complete"),
      false,
    );
    twilio.close();
  } finally {
    stopChild(gateway);
    await Promise.all([
      new Promise<void>((resolve) => appServer.close(() => resolve())),
      new Promise<void>((resolve) => openAiWss.close(() => resolve())),
      new Promise<void>((resolve) => openAiServer.close(() => resolve())),
    ]);
  }
});
