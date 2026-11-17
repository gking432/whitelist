export type ActionPreflight = () => Promise<string | null>;

/** A preflight suppression proves that this invocation made no provider write. */
export class ActionSuppressedError extends Error {}

export async function runActionPreflight(check?: ActionPreflight): Promise<void> {
  const reason = await check?.();
  if (reason) throw new ActionSuppressedError(reason);
}
