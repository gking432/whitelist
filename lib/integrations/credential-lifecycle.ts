// Persistence handlers are held outside credential JSON, so they can never be
// serialized into a secret, a provider request, or an audit record.
const stores = new WeakMap<object, (credentials: object) => Promise<void>>();
export function registerCredentialStore(credentials: object, store: (credentials: object) => Promise<void>) {
  stores.set(credentials, store);
}
export async function persistRotatedCredentials(credentials: object) {
  const store = stores.get(credentials);
  if (store) await store(credentials);
}
