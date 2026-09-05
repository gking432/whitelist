import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import type { EmbeddedBinding } from "./runtime.ts";
import { mapFields, validateInbound, validateFields } from "./mapping.ts";
import {
  authenticationMatches,
  type ZapierClient,
  type InboxLease,
} from "./zapier.ts";

// Commit to our encrypted, deduplicated queue before acknowledging Zapier.
// A lost acknowledgment re-delivers the same message id, never a second run.
export async function commitInboxLease(input: {
  lease: InboxLease;
  binding: EmbeddedBinding;
  commit: (
    messageId: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  acknowledge: (leaseId: string, ids: string[]) => Promise<unknown>;
  requiredFields: string[];
}) {
  const { lease, binding } = input;
  if (lease.inbox_attributes?.status !== "active")
    throw new Error(
      "The app stopped collecting events. Review its connection before continuing.",
    );
  let committed = 0;
  for (const message of lease.results) {
    if (!lease.lease_id)
      throw new Error("The event service returned a message without a lease.");
    if (
      message.message_attributes?.error_message ||
      message.message_attributes?.possible_duplicate_data
    )
      throw new Error(
        "An incoming event needs review before processing; it may be incomplete or duplicated.",
      );
    const data = mapFields(message.payload, binding.field_mapping);
    validateInbound(input.requiredFields, data);
    await input.commit(message.id, {
      ...data,
      _embedded_binding_id: binding.id,
    });
    await input.acknowledge(lease.lease_id, [message.id]);
    committed += 1;
  }
  return committed;
}

export async function createApprovedExternalRun(
  api: ZapierClient,
  input: {
    appId: string;
    authenticationId: string;
    actionKey: string;
    values: Record<string, unknown>;
    onRunId: (id: string) => Promise<void>;
  },
): Promise<DeliveryOutcome> {
  const auths = await api.authentications(input.appId);
  if (
    !auths.some((auth) =>
      authenticationMatches(auth, input.appId, input.authenticationId),
    )
  )
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail:
        "Reconnect this app account before submitting the approved action.",
    };
  // A fresh action id is mandatory on every submission, including safe retries.
  const action = await api.action(input.appId, input.actionKey, "WRITE");
  validateFields(
    await api.fields(action.id, input.authenticationId, input.values),
    input.values,
  );
  let result;
  try {
    result = await api.request<{ data: { id?: string; status?: string } }>(
      "/v2/action-runs/",
      {
        data: {
          action: action.id,
          authentication: input.authenticationId,
          input: input.values,
        },
      },
    );
  } catch {
    return {
      status: "uncertain",
      attempted: true,
      delivered: false,
      detail:
        "The external app may have received this action. Check its records before submitting anything again.",
    };
  }
  if (!result.data?.id)
    return {
      status: "uncertain",
      attempted: true,
      delivered: false,
      detail:
        "The connection service returned no run reference. Reconcile this action before any resend.",
    };
  await input.onRunId(result.data.id);
  return {
    status: "provider_pending",
    attempted: true,
    delivered: false,
    externalRef: result.data.id,
    detail:
      "Submitted to the connected app. Waiting for its confirmed result; no duplicate submission will be made.",
  };
}
