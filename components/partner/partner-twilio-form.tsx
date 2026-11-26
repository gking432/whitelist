"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Eye, EyeOff, PhoneCall, ShieldCheck } from "lucide-react";

import { connectPartnerTwilio } from "@/app/partner/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormState } from "@/lib/forms/state";
import { partnerTwilioConnectionIsReady } from "@/lib/onboarding/partner";

type Props = {
  connection: {
    status: string;
    credentialStatus: string;
    healthSummary: string | null;
    accountSid: string | null;
    lastSuccessAt: string | null;
  } | null;
  compact?: boolean;
};

export function PartnerTwilioForm({ connection, compact = false }: Props) {
  const [state, action, pending] = useActionState(
    connectPartnerTwilio,
    initialFormState,
  );
  const [showToken, setShowToken] = useState(false);
  const connected = partnerTwilioConnectionIsReady(
    connection
      ? {
          status: connection.status,
          credential_status: connection.credentialStatus,
          last_success_at: connection.lastSuccessAt,
        }
      : null,
  );

  return (
    <section className={compact ? "space-y-4" : "rounded-lg border bg-card p-5 sm:p-6"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <PhoneCall className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Twilio billing account</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              This is your parent account. Twilio bills your agency directly, and every client subaccount, number, and usage charge stays under your ownership.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "w-fit"}
        >
          {connected ? "Connected" : "Not connected"}
        </Badge>
      </div>

      {connected && connection ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Ready to provision client phone systems
          </p>
          {connection.accountSid ? <p className="mt-1 font-mono text-xs">{connection.accountSid}</p> : null}
          {connection.healthSummary ? <p className="mt-2 text-xs leading-5">{connection.healthSummary}</p> : null}
        </div>
      ) : null}

      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="partner-twilio-sid">Account SID</Label>
            <Input
              id="partner-twilio-sid"
              name="account_sid"
              placeholder="AC..."
              autoComplete="off"
              aria-invalid={Boolean(state.fieldErrors?.account_sid)}
            />
            {state.fieldErrors?.account_sid ? <p className="text-xs text-destructive">{state.fieldErrors.account_sid}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner-twilio-token">Auth Token</Label>
            <div className="relative">
              <Input
                id="partner-twilio-token"
                name="auth_token"
                type={showToken ? "text" : "password"}
                placeholder="Twilio Auth Token"
                autoComplete="off"
                className="pr-10"
                aria-invalid={Boolean(state.fieldErrors?.auth_token)}
              />
              <button
                type="button"
                title={showToken ? "Hide token" : "Show token"}
                className="absolute right-1 top-1 flex size-7 items-center justify-center text-muted-foreground"
                onClick={() => setShowToken((value) => !value)}
              >
                {showToken ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                <span className="sr-only">{showToken ? "Hide token" : "Show token"}</span>
              </button>
            </div>
            {state.fieldErrors?.auth_token ? <p className="text-xs text-destructive">{state.fieldErrors.auth_token}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" disabled={pending}>
            <ShieldCheck aria-hidden="true" />
            {pending ? "Verifying..." : connected ? "Replace connection" : "Verify and connect Twilio"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Encrypted immediately. Clients and platform support cannot view the token.
          </p>
        </div>
        {state.message ? (
          <p role="status" className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700"}>
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
