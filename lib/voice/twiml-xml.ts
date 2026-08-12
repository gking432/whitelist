function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildAiStreamTwimlXml(input: {
  actionUrl: string;
  callSessionId: string;
  streamUrl: string;
  streamToken: string;
  fallbackSpeech: string | null;
}): string {
  const fallbackSpeech = input.fallbackSpeech?.trim()
    ? `<Say>${escapeXml(input.fallbackSpeech.trim())}</Say>`
    : "";
  const stream =
    `<Connect><Stream url="${escapeXml(input.streamUrl)}">` +
    `<Parameter name="callSessionId" value="${escapeXml(input.callSessionId)}"/>` +
    `<Parameter name="streamToken" value="${escapeXml(input.streamToken)}"/>` +
    `<Parameter name="mode" value="ai_answered"/>` +
    `</Stream></Connect>`;
  const fallback =
    `<Gather input="speech" action="${escapeXml(input.actionUrl)}" method="POST" ` +
    `speechTimeout="auto" timeout="5" actionOnEmptyResult="true">` +
    `${fallbackSpeech}</Gather>`;

  return `${stream}${fallback}`;
}
