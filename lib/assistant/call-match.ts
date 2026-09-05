export function resolveAssistantCallMatchStatus(input: {
  resolverStatus: unknown;
  matchedContactId: string | null;
}): "matched" | "created" | "unavailable" {
  const resolverStatus =
    typeof input.resolverStatus === "string"
      ? input.resolverStatus.trim()
      : null;

  if (resolverStatus === "created") return "created";
  if (resolverStatus === "matched" || input.matchedContactId) return "matched";
  return "unavailable";
}
