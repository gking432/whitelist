/** Compare against the configured public application, never a normalized
 * NextURL or untrusted forwarded/Host header. Keep scheme and port exact. */
export function isSameOrigin(origin: string | null, appUrl: string): boolean {
  try { return origin !== null && origin === new URL(appUrl).origin; } catch { return false; }
}
