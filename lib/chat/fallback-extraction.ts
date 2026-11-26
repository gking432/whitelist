const NAME_PATTERN =
  /\b(?:i['’]?m|i am|my name is|this is)\s+([a-z][a-z' -]{1,40}?)(?=[,.]|\s+(?:and|my|at)\b|$)/i;

export function extractFallbackName(message: string): string | null {
  return message.match(NAME_PATTERN)?.[1]?.trim() ?? null;
}
