import { createHash } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Postgres is the source of truth in production so quotas hold across every
// app instance. The bounded in-memory window is an availability fallback.

type WindowState = {
  windowStartMs: number;
  count: number;
};

const windows = new Map<string, WindowState>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_TRACKED_KEYS = 10_000;

function checkLocalRateLimit(key: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const state = windows.get(key);

  if (!state || now - state.windowStartMs >= WINDOW_MS) {
    if (windows.size >= MAX_TRACKED_KEYS && !windows.has(key)) {
      // Drop the oldest window rather than grow without bound.
      const oldestKey = windows.keys().next().value;

      if (oldestKey !== undefined) {
        windows.delete(oldestKey);
      }
    }

    windows.set(key, { windowStartMs: now, count: 1 });

    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (state.count >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(
        (state.windowStartMs + WINDOW_MS - now) / 1000,
      ),
    };
  }

  state.count += 1;

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function checkRateLimit(
  key: string,
  options: { limit?: number; windowSeconds?: number } = {},
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_REQUESTS_PER_WINDOW, 10_000));
  const windowSeconds = Math.max(1, Math.min(options.windowSeconds ?? WINDOW_MS / 1000, 86_400));
  const admin = createSupabaseAdminClient();

  if (admin) {
    const keyHash = createHash("sha256").update(key).digest("hex");
    const { data, error } = await admin.rpc("consume_api_rate_limit", {
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    const result = Array.isArray(data) ? data[0] : data;

    if (!error && result && typeof result.allowed === "boolean") {
      return {
        allowed: result.allowed,
        retryAfterSeconds: Number(result.retry_after_seconds ?? 0),
      };
    }
  }

  return checkLocalRateLimit(`${key}:${limit}:${windowSeconds}`);
}
