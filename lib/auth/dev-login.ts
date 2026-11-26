type LocalDevAuthClient = {
  auth: {
    signOut(options: { scope: "local" }): Promise<unknown>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ error: { message: string } | null }>;
  };
};

export async function switchLocalDevUser(
  client: LocalDevAuthClient,
  credentials: { email: string; password: string },
) {
  await client.auth.signOut({ scope: "local" });
  return client.auth.signInWithPassword(credentials);
}
