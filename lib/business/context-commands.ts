import { z } from "zod";
import { AUTHORITY_CHANNELS, AUTHORITY_MODES, type AuthorityChannel } from "./context-contract.ts";

export class BusinessCommandError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const common = { key: z.uuid() };
export const ContextCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("review_context"), expectedContextRevision: z.string().min(1).max(100) }).strict(),
  z.object({ ...common, action: z.literal("set_authority"), expectedRevision: z.number().int().nonnegative(), channel: z.enum(AUTHORITY_CHANNELS), mode: z.enum(AUTHORITY_MODES) }).strict(),
  z.object({ ...common, action: z.literal("manager_control"), expectedRevision: z.number().int().nonnegative(), command: z.string().trim().min(1).max(150) }).strict(),
]);
export function parseManagerControl(command: string): { operation: "pause" | "resume" | "stop"; channel?: AuthorityChannel } {
  const value = command.trim().toLowerCase().replace(/[.!]$/, "");
  if (value === "pause team") return { operation: "pause" };
  if (value === "resume team") return { operation: "resume" };
  const match = /^stop using (website|email|sms|instagram|calendar)$/.exec(value);
  if (match) return { operation: "stop", channel: match[1] as AuthorityChannel };
  throw new BusinessCommandError("No settings changed. Use Pause team, Resume team, or Stop using a supported channel.", 422);
}
export function normalizeContextCommand(raw: unknown) {
  const command = ContextCommandSchema.parse(raw);
  return command.action === "manager_control" ? { ...command, ...parseManagerControl(command.command) } : command;
}

/** Control-like requests must never become free-form model acknowledgements. */
export function isManagerControlIntent(request: string): boolean {
  return /^(?:pause|resume|stop|disable|turn\s+off)\b/i.test(request.trim());
}
