// Fixed-window rate limiter, in-memory per server instance. Good enough to
// blunt abuse on the public webhook endpoint for the first release; move to a
// durable store (Redis/Postgres) when intake moves behind a queue.

type WindowState = {
  windowStartMs: number;
  count: number;
};

const windows = new Map<string, WindowState>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_TRACKED_KEYS = 10_000;

export function checkRateLimit(key: string): {
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
