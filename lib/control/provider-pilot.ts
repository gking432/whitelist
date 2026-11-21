export type ProviderPilotReadinessInput = {
  connectionStatus: string;
  credentialStatus: string;
  runtimeMode: string;
  supportsInbound: boolean;
  supportsOutbound: boolean;
  inboundEventId?: string | null;
  outboundEventId?: string | null;
  readEvidence?: string | null;
  retryEvidence?: string | null;
  revocationEvidence?: string | null;
};

export type ProviderPilotProof = {
  key: string;
  label: string;
  complete: boolean;
};

export function providerPilotReadiness(
  input: ProviderPilotReadinessInput,
): { ready: boolean; proofs: ProviderPilotProof[] } {
  const proofs: ProviderPilotProof[] = [
    {
      key: "credentials",
      label: "Verified credentials on a connected live account",
      complete:
        input.connectionStatus === "connected" &&
        input.credentialStatus === "configured" &&
        input.runtimeMode === "live",
    },
    ...(input.supportsInbound
      ? [
          {
            key: "inbound",
            label: "Processed real inbound event",
            complete: Boolean(input.inboundEventId),
          },
        ]
      : []),
    ...(input.supportsOutbound
      ? [
          {
            key: "outbound",
            label: "Processed real outbound action",
            complete: Boolean(input.outboundEventId),
          },
        ]
      : []),
    {
      key: "read",
      label: "Provider read or account lookup verified",
      complete: (input.readEvidence?.trim().length ?? 0) >= 12,
    },
    {
      key: "retry",
      label: "Retry and idempotency behavior verified",
      complete: (input.retryEvidence?.trim().length ?? 0) >= 12,
    },
    {
      key: "revocation",
      label: "Credential revocation or disconnect verified",
      complete: (input.revocationEvidence?.trim().length ?? 0) >= 12,
    },
  ];

  return { ready: proofs.every((proof) => proof.complete), proofs };
}
