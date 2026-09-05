import { createHash } from "node:crypto";

export type AITenant = { partnerId: string; clientId?: string | null };

export function aiBudgetLimit(value = process.env.AI_DAILY_TOKEN_LIMIT): number {
  const parsed = Number(value ?? 100_000);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 10_000_000)) : 100_000;
}

export function aiReservation(input: { system: string; user: string; format: unknown; maxTokens: number }) {
  // Byte length is a conservative text-token ceiling. Include schema and a
  // framing allowance; no prompt is stored in the accounting tables.
  const prompt = JSON.stringify([input.system, input.user, input.format]);
  return {
    promptHash: createHash("sha256").update(prompt).digest("hex"),
    tokens: Buffer.byteLength(prompt, "utf8") + input.maxTokens + 4096,
  };
}
