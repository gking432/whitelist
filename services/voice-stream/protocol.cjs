function realtimeSessionUpdate(input) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: input.model,
      output_modalities: ["audio"],
      instructions: input.instructions,
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          transcription: { model: input.transcriptionModel },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: { type: "audio/pcmu" },
          voice: input.voice,
        },
      },
      tools: input.tools,
      tool_choice: "auto",
    },
  };
}

function initialResponse(instruction) {
  return {
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      instructions: instruction,
    },
  };
}

function twilioMedia(streamSid, payload) {
  return { event: "media", streamSid, media: { payload } };
}

function twilioMark(streamSid, name) {
  return { event: "mark", streamSid, mark: { name } };
}

function twilioClear(streamSid) {
  return { event: "clear", streamSid };
}

function functionCallsFromResponse(event) {
  if (event?.type !== "response.done" || !Array.isArray(event.response?.output)) {
    return [];
  }

  return event.response.output
    .filter(
      (item) =>
        item?.type === "function_call" &&
        typeof item.call_id === "string" &&
        typeof item.name === "string",
    )
    .map((item) => ({
      callId: item.call_id,
      name: item.name,
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
    }));
}

function functionCallOutput(callId, output) {
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  };
}

function truncateAssistantItem(itemId, audioEndMs) {
  return {
    type: "conversation.item.truncate",
    item_id: itemId,
    content_index: 0,
    audio_end_ms: Math.max(0, Math.floor(audioEndMs)),
  };
}

module.exports = {
  functionCallOutput,
  functionCallsFromResponse,
  initialResponse,
  realtimeSessionUpdate,
  truncateAssistantItem,
  twilioClear,
  twilioMark,
  twilioMedia,
};
