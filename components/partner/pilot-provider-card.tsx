"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, ShieldCheck, X } from "lucide-react";

import {
  connectPilotProvider,
  setPilotLiveMode,
  startGoogleConnect,
  startWorkspaceConnect,
  startJobberConnect,
  startCommerceConnect,
  testPilotConnection,
} from "@/app/partner/clients/[clientId]/pilot/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime, formatEnum } from "@/lib/format";
import type { PilotProviderMeta } from "@/lib/integrations/pilot";
import { initialFormState, type FormState } from "@/lib/forms/state";
import { cn } from "@/lib/utils";

export type PilotConnectionSummary = {
  id: string;
  status: string;
  runtime_mode: string;
  credential_status: string;
  health_summary: string | null;
  last_success_at: string | null;
};

type PilotProviderCardProps = {
  clientId: string;
  meta: PilotProviderMeta;
  connection: PilotConnectionSummary | null;
  // Shown on the Google card so the partner can paste it into Google Cloud.
  oauthRedirectUri?: string;
  // Shown once connected (Twilio): the URL to paste into the provider so
  // inbound messages flow back into Northstar.
  inboundWebhookUrl?: string;
  // Twilio Voice URLs for the number's incoming-call and status callbacks.
  voiceWebhookUrl?: string;
  voiceStatusUrl?: string;
  canManage: boolean;
  embedded?: boolean;
};

const statusStyles: Record<string, string> = {
  not_connected: "border-slate-200 bg-slate-50 text-slate-700",
  connected: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
  disabled: "border-slate-200 bg-slate-50 text-slate-500",
};

export function PilotProviderCard({
  clientId,
  meta,
  connection,
  oauthRedirectUri,
  inboundWebhookUrl,
  voiceWebhookUrl,
  voiceStatusUrl,
  canManage,
  embedded = false,
}: PilotProviderCardProps) {
  const isLegacyGoogle = meta.key === "google_calendar";
  const isWorkspace = meta.key === "google_workspace" || meta.key === "microsoft_365";
  const isJobber = meta.key === "jobber";
  const isCommerceOAuth = meta.key === "quickbooks_online" || meta.key === "square";
  const isOAuth = isLegacyGoogle || isWorkspace || isJobber || isCommerceOAuth;
  const commerceKey = meta.key === "square" ? "square" : "quickbooks_online";
  const workspaceKey = meta.key === "microsoft_365" ? "microsoft_365" : "google_workspace";
  const boundConnect = isCommerceOAuth
    ? startCommerceConnect.bind(null, clientId, commerceKey)
    : isJobber
    ? startJobberConnect.bind(null, clientId)
    : isWorkspace
    ? startWorkspaceConnect.bind(null, clientId, workspaceKey)
    : isLegacyGoogle
      ? startGoogleConnect.bind(null, clientId)
      : connectPilotProvider.bind(null, clientId, meta.key);

  const [connectState, connectAction, connectPending] = useActionState(
    boundConnect,
    initialFormState,
  );

  const [showForm, setShowForm] = useState(!connection);
  const [actionResult, setActionResult] = useState<FormState | null>(null);
  const [isPending, startTransition] = useTransition();

  const isConnected = connection?.status === "connected";
  const isLive = connection?.runtime_mode === "live";

  return (
    <section
      className={cn(
        embedded
          ? "bg-card px-4 pb-5 pt-2 sm:px-5"
          : "rounded-lg border bg-card p-6",
      )}
    >
      {!embedded ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">{meta.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{meta.tagline}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {connection ? (
              <>
                <Badge
                  variant="outline"
                  className={statusStyles[connection.status] ?? ""}
                >
                  {formatEnum(connection.status)}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    isLive
                      ? "border-red-200 bg-red-50 text-red-900"
                      : "border-slate-200 bg-slate-50 text-slate-700",
                  )}
                >
                  {isLive ? "LIVE" : formatEnum(connection.runtime_mode)}
                </Badge>
              </>
            ) : (
              <Badge
                variant="outline"
                className="border-slate-200 bg-slate-50 text-slate-700"
              >
                Not set up
              </Badge>
            )}
          </div>
        </div>
      ) : null}

      <div className={cn("grid gap-4 sm:grid-cols-2", !embedded && "mt-4")}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What this lets Northstar do
          </p>
          <ul className="mt-2 space-y-1.5">
            {meta.allows.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What it will never do
          </p>
          <ul className="mt-2 space-y-1.5">
            {meta.neverDoes.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-5">
                <X
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {connection && inboundWebhookUrl ? (
        <div className="mt-4 rounded-md border bg-secondary/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inbound messages
          </p>
          <p className="mt-1 text-sm leading-5">
            To route customer replies back into Northstar, set this URL as the
            phone number&apos;s &quot;A message comes in&quot; webhook (HTTP
            POST) in the provider console:
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
            {inboundWebhookUrl}
          </code>
        </div>
      ) : null}

      {connection && voiceWebhookUrl ? (
        <div className="mt-4 rounded-md border bg-secondary/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI phone answering
          </p>
          <p className="mt-1 text-sm leading-5">
            In Twilio, open this phone number and set &quot;A call comes
            in&quot; to Webhook, HTTP POST:
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
            {voiceWebhookUrl}
          </code>
          {voiceStatusUrl ? (
            <>
              <p className="mt-3 text-sm leading-5">
                Set the call status callback to this URL (HTTP POST) so hangups
                always finish the transcript and CRM pipeline:
              </p>
              <code className="mt-2 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
                {voiceStatusUrl}
              </code>
            </>
          ) : null}
        </div>
      ) : null}

      {connection?.health_summary ? (
        <div className="mt-4 rounded-md border bg-secondary/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Connection health
          </p>
          <p className="mt-1 text-sm leading-5">{connection.health_summary}</p>
          {connection.last_success_at ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Last confirmed working:{" "}
              {formatDateTime(connection.last_success_at)}
            </p>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connection ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await testPilotConnection(
                      clientId,
                      connection.id,
                    );
                    setActionResult(result);
                  })
                }
              >
                {isPending ? "Testing…" : "Test connection"}
              </Button>
              {isConnected ? (
                <Button
                  type="button"
                  variant={isLive ? "outline" : "default"}
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await setPilotLiveMode(
                        clientId,
                        connection.id,
                        !isLive,
                      );
                      setActionResult(result);
                    })
                  }
                >
                  {isLive ? "Switch back to dry run" : "Go live"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowForm((value) => !value)}
              >
                {showForm
                  ? "Hide credentials form"
                  : "Reconnect / update credentials"}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {actionResult?.message ? (
        <p
          className={cn(
            "mt-2 text-sm",
            actionResult.status === "error"
              ? "text-destructive"
              : "text-emerald-700",
          )}
        >
          {actionResult.message}
        </p>
      ) : null}

      {canManage && showForm ? (
        <form action={connectAction} className="mt-5 space-y-4 border-t pt-5">
          <div className="rounded-md border bg-secondary/40 px-4 py-3 text-sm leading-6">
            <p className="font-medium">Where to get these</p>
            <p className="mt-1 text-muted-foreground">{meta.whereToGet}</p>
            {isLegacyGoogle && oauthRedirectUri ? (
              <div className="mt-2">
                <p className="font-medium">
                  Authorized redirect URI (paste into Google Cloud):
                </p>
                <code className="mt-1 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
                  {oauthRedirectUri}
                </code>
              </div>
            ) : null}
          </div>

          {meta.fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`${meta.key}-${field.name}`}>{field.label}</Label>
              {field.options ? (
                <select
                  id={`${meta.key}-${field.name}`}
                  name={field.name}
                  defaultValue={field.options[0]?.value}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-invalid={Boolean(connectState.fieldErrors?.[field.name])}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${meta.key}-${field.name}`}
                  name={field.name}
                  type={field.secret ? "password" : "text"}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  aria-invalid={Boolean(connectState.fieldErrors?.[field.name])}
                />
              )}
              {connectState.fieldErrors?.[field.name] ? (
                <p className="text-xs text-destructive">
                  {connectState.fieldErrors[field.name]}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{field.help}</p>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={connectPending}>
              <ShieldCheck aria-hidden="true" />
              {connectPending
                ? "Checking…"
                : isOAuth
                  ? `Authorize with ${meta.title}`
                  : connection
                    ? "Verify & save new credentials"
                    : "Verify & connect"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {isOAuth
                ? `The client signs in directly with ${meta.title}; tokens are encrypted and never shown to the partner.`
                : `Credentials are checked against ${meta.title} first, then stored encrypted. They are never shown again.`}
            </p>
          </div>

          {connectState.message ? (
            <p
              className={cn(
                "text-sm",
                connectState.status === "error"
                  ? "text-destructive"
                  : "text-emerald-700",
              )}
            >
              {connectState.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
