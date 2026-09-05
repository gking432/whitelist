import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/env";
import { buildAiStreamTwimlXml } from "@/lib/voice/twiml-xml";

export const TWILIO_VOICE_PROVIDER = "twilio_voice";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function twilioVoiceUrl(
  connectionId: string,
  suffix = "",
): string {
  return `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connectionId}${suffix}`;
}

export function twilioVoiceTwiml(xml: string, status = 200): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`,
    {
      status,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export function gatherTwiml(input: {
  connectionId: string;
  callSessionId: string;
  speech?: string | null;
  attempt?: number;
}): NextResponse {
  const attempt = input.attempt ?? 0;
  const action = twilioVoiceUrl(
    input.connectionId,
    `/turn?session=${encodeURIComponent(input.callSessionId)}&attempt=${attempt}`,
  );
  const speech = input.speech?.trim()
    ? `<Say>${escapeXml(input.speech.trim())}</Say>`
    : "";

  return twilioVoiceTwiml(
    `<Gather input="speech" action="${escapeXml(action)}" method="POST" ` +
      `speechTimeout="auto" timeout="5" actionOnEmptyResult="true">${speech}</Gather>`,
  );
}

export function staffAssistTwiml(input: {
  connectionId: string;
  callSessionId: string;
  forwardNumber: string;
  streamUrl: string | null;
  streamToken: string | null;
}): NextResponse {
  const stream = input.streamUrl
    ? `<Start><Stream url="${escapeXml(input.streamUrl)}" track="both_tracks">` +
      `<Parameter name="callSessionId" value="${escapeXml(input.callSessionId)}"/>` +
      (input.streamToken
        ? `<Parameter name="streamToken" value="${escapeXml(input.streamToken)}"/>`
        : "") +
      `</Stream></Start>`
    : "";
  const dial =
    `<Dial answerOnBridge="true" timeout="25">` +
    `<Number>${escapeXml(input.forwardNumber)}</Number></Dial>`;

  return twilioVoiceTwiml(`${stream}${dial}<Hangup/>`);
}

export function aiStreamTwiml(input: {
  connectionId: string;
  callSessionId: string;
  streamUrl: string;
  streamToken: string;
  fallbackSpeech: string | null;
}): NextResponse {
  const action = twilioVoiceUrl(
    input.connectionId,
    `/turn?session=${encodeURIComponent(input.callSessionId)}&attempt=0`,
  );
  return twilioVoiceTwiml(
    buildAiStreamTwimlXml({
      actionUrl: action,
      callSessionId: input.callSessionId,
      streamUrl: input.streamUrl,
      streamToken: input.streamToken,
      fallbackSpeech: input.fallbackSpeech,
    }),
  );
}

export function hangupTwiml(speech?: string | null): NextResponse {
  const say = speech?.trim()
    ? `<Say>${escapeXml(speech.trim())}</Say>`
    : "";

  return twilioVoiceTwiml(`${say}<Hangup/>`);
}

export function rejectVoiceWebhook(status: number): NextResponse {
  return NextResponse.json({ error: "Rejected." }, { status });
}
