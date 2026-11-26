export function operationalClients<T extends { is_test_account: boolean }>(
  clients: T[],
) {
  return clients.filter((client) => !client.is_test_account);
}
