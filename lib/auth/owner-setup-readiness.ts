import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaVersionIsCompatible } from "../ops/schema-version.ts";

export const OWNER_SETUP_READ_TIMEOUT_MS = 5000;
export type OwnerSetupReadiness = { available: boolean; message: string };
export type OwnerSetupReadinessRepository = {
  readSchemaMarker(signal: AbortSignal): PromiseLike<{ data: unknown; error?: unknown }>;
};

const unavailable = (): OwnerSetupReadiness => ({ available: false, message: "Business setup is temporarily unavailable. Please try again shortly." });

/** A UI prerequisite only. It grants no identity, membership, provisioning,
 * assistant, provider or execution access. The returned message never includes
 * repository data or diagnostics. The injectable reader performs one read. */
export async function checkOwnerSetupReadiness(
  repository: OwnerSetupReadinessRepository | null | undefined,
  options: { timeoutMs?: number } = {},
): Promise<OwnerSetupReadiness> {
  const timeoutMs = options.timeoutMs ?? OWNER_SETUP_READ_TIMEOUT_MS;
  if (!repository || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > OWNER_SETUP_READ_TIMEOUT_MS) return unavailable();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
    });
    // The hard deadline remains effective even if an injected transport fails
    // to honour abort. Promise.race also observes a later read rejection.
    const result = await Promise.race([
      Promise.resolve().then(() => repository.readSchemaMarker(controller.signal)),
      deadline,
    ]);
    if (!result || controller.signal.aborted || result.error != null || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return unavailable();
    const marker = (result.data as { current_migration?: unknown }).current_migration;
    if (typeof marker !== "string" || !schemaVersionIsCompatible(marker)) return unavailable();
    return { available: true, message: "Business setup is available." };
  } catch { return unavailable(); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Server callers supply an already-created admin client; this module never
 * creates clients, loads config, reads tenants or exposes a browser callback. */
export async function readOwnerSetupReadiness(admin: SupabaseClient | null | undefined): Promise<OwnerSetupReadiness> {
  if (!admin || typeof window !== "undefined") return unavailable();
  return checkOwnerSetupReadiness({
    readSchemaMarker: (signal) => admin.from("platform_schema_state")
      .select("current_migration").eq("singleton", true).abortSignal(signal).maybeSingle(),
  });
}
