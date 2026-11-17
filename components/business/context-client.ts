import type {
  BusinessCommandResult,
  BusinessContextCommand,
  BusinessContextSnapshot,
} from "../../lib/business/context-contract.ts";

export type ContextCommandResponse = {
  result: BusinessCommandResult;
  snapshot: BusinessContextSnapshot;
};

export class ContextRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ContextRequestError";
    this.status = status;
  }
}

export async function fetchBusinessContext(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<BusinessContextSnapshot> {
  const response = await fetcher("/api/business/context", {
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ContextRequestError(data.error || "Business context could not be loaded.", response.status);
  return data;
}

export async function sendBusinessContextCommand(
  command: BusinessContextCommand,
  fetcher: typeof fetch = fetch,
): Promise<ContextCommandResponse> {
  const response = await fetcher("/api/business/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ContextRequestError(data.error || "The change could not be saved.", response.status);
  // A successful HTTP response alone must not produce a Saved message.
  if (!data.result?.id || !data.snapshot || typeof data.result.message !== "string")
    throw new ContextRequestError("The server did not confirm the saved change. Refresh before retrying.", 502);
  return data;
}

/** Only these unambiguous controls bypass the paused assignment queue. */
export function isDirectManagerControl(text: string): boolean {
  return /^(?:pause team|resume team|stop using (?:instagram|email|sms|website|calendar))[.!]?$/i.test(text.trim());
}
