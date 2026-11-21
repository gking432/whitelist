export function releaseId(env: Record<string, string | undefined> = process.env) {
  const raw = env.RENDER_GIT_COMMIT ?? env.GITHUB_SHA ?? env.RELEASE_SHA ?? "";
  const normalized = raw.trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}
