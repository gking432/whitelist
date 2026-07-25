import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/env";

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

export function hangupTwiml(speech?: string | null): NextResponse {
  const say = speech?.trim()
    ? `<Say>${escapeXml(speech.trim())}</Say>`
    : "";

  return twilioVoiceTwiml(`${say}<Hangup/>`);
}

export function rejectVoiceWebhook(status: number): NextResponse {
  return NextResponse.json({ error: "Rejected." }, { status });
}
