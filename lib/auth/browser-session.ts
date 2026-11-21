export function sessionTokensFromHash(hash: string): {
  accessToken: string;
  refreshToken: string;
} | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}
