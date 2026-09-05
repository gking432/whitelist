export type AssistantOperatingConnection = {
  status: string;
  runtime_mode: string;
  provider: {
    provider_key: string;
    category: string;
    display_name: string;
    native_capabilities?: string[] | null;
  } | null;
};

export function resolveAssistantOperatingSystem(input: {
  crmOperatingMode: string;
  connections: AssistantOperatingConnection[];
}) {
  const nativeCrm = ["primary_crm", "mirror", "assist"].includes(
    input.crmOperatingMode,
  );
  const usable = (connection: AssistantOperatingConnection) =>
    ["connected", "needs_attention"].includes(connection.status);
  const connection =
    input.connections.find(
      (candidate) =>
        candidate.provider?.category === "crm" && usable(candidate),
    ) ??
    input.connections.find(
      (candidate) =>
        candidate.provider?.category === "field_service" && usable(candidate),
    );

  return {
    connection,
    connectionInfo: connection
      ? { connected: true, live: connection.runtime_mode === "live" }
      : { connected: nativeCrm, live: nativeCrm },
    providerLabel: connection?.provider?.display_name ?? "Northstar CRM",
    nativeCrmOnly: nativeCrm && !connection,
    supportsNotes:
      (nativeCrm && !connection) ||
      Boolean(
        connection?.provider?.native_capabilities?.includes("note.create"),
      ),
  };
}
