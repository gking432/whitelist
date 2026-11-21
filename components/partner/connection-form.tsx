"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import type { ConnectionFormState } from "@/app/partner/clients/[clientId]/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RUNTIME_MODES } from "@/lib/clients/constants";
import { formatEnum } from "@/lib/format";
import {
  OUTBOUND_WEBHOOK_PROVIDER_KEY,
  type IntegrationProviderRecord,
} from "@/lib/integrations/types";

type ConnectionFormProps = {
  clientId: string;
  providers: IntegrationProviderRecord[];
  appUrl: string;
  action: (
    previousState: ConnectionFormState,
    formData: FormData,
  ) => Promise<ConnectionFormState>;
};

const initialState: ConnectionFormState = { status: "idle" };

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-1.5 text-xs text-destructive">{message}</p>;
}

export function ConnectionForm({
  clientId,
  providers,
  appUrl,
  action,
}: ConnectionFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");

  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  );
  const isInbound = Boolean(selectedProvider?.supports_inbound);
  const isOutbound =
    selectedProvider?.provider_key === OUTBOUND_WEBHOOK_PROVIDER_KEY;
  const errors = state.fieldErrors ?? {};

  if (state.status === "success" && state.connectionId) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {state.message}
        </div>

        {state.oneTimeToken ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              Connection credential — shown only once
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">
              Store this value in the external system now. It cannot be
              retrieved again; if it is lost, rotate the credential from the
              connection page.
            </p>
            <code className="mt-3 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
              {state.oneTimeToken}
            </code>
            {state.endpointPath ? (
              <div className="mt-3">
                <p className="text-xs font-medium text-amber-900">
                  Send events to:
                </p>
                <code className="mt-1 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
                  POST {appUrl}
                  {state.endpointPath}
                </code>
                <p className="mt-2 text-xs leading-5 text-amber-900/80">
                  Include the credential in an{" "}
                  <code className="font-mono">x-webhook-token</code> header.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button asChild>
            <Link
              href={`/partner/clients/${clientId}/integrations/${state.connectionId}`}
            >
              Open connection
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/partner/clients/${clientId}/integrations`}>
              Back to integrations
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="provider_id">Provider</Label>
          <Select
            id="provider_id"
            name="provider_id"
            className="mt-1.5"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.display_name}
              </option>
            ))}
          </Select>
          <FieldError message={errors.provider_id} />
        </div>
        <div>
          <Label htmlFor="display_name">Connection name</Label>
          <Input
            id="display_name"
            name="display_name"
            className="mt-1.5"
            placeholder="CRM lead events"
            required
          />
          <FieldError message={errors.display_name} />
        </div>
        <div>
          <Label htmlFor="runtime_mode">Runtime mode</Label>
          <Select
            id="runtime_mode"
            name="runtime_mode"
            className="mt-1.5"
            defaultValue="sandbox"
          >
            {RUNTIME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatEnum(mode)}
              </option>
            ))}
          </Select>
          <FieldError message={errors.runtime_mode} />
        </div>
        {isOutbound ? (
          <div>
            <Label htmlFor="outbound_url">Destination URL (HTTPS)</Label>
            <Input
              id="outbound_url"
              name="outbound_url"
              className="mt-1.5"
              placeholder="https://"
              inputMode="url"
            />
            <FieldError message={errors.outbound_url} />
          </div>
        ) : null}
      </div>

      {isInbound ? (
        <p className="rounded-md border bg-secondary/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
          A unique endpoint and credential are generated for this connection.
          The credential is shown once after creation and stored encrypted.
        </p>
      ) : null}
      {isOutbound ? (
        <p className="rounded-md border bg-secondary/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
          A signing secret is generated and stored encrypted. Outbound delivery
          sends additive CRM contact and AI-note payloads in live mode. The
          receiver must verify the signature before accepting them.
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create connection"}
      </Button>
    </form>
  );
}
