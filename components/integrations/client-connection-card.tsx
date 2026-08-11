"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, PhoneCall, PlugZap } from "lucide-react";

import {
  connectClientAccount,
  provisionClientPhoneNumber,
  startClientGoogleConnect,
} from "@/app/connect/[token]/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormState } from "@/lib/forms/state";
import type { PilotProviderKey, PilotProviderMeta } from "@/lib/integrations/pilot";
import { cn } from "@/lib/utils";

type Props = {
  token: string;
  provider: PilotProviderMeta;
  connected: boolean;
  productName: string;
  supportName: string;
  googleReady: boolean;
  managedTwilioReady: boolean;
};

function ResultMessage({ state }: { state: typeof initialFormState }) {
  return state.message ? (
    <p
      role="status"
      className={cn(
        "mt-3 text-sm leading-5",
        state.status === "error" ? "text-destructive" : "text-emerald-700",
      )}
    >
      {state.message}
    </p>
  ) : null;
}

export function ClientConnectionCard({
  token,
  provider,
  connected,
  productName,
  supportName,
  googleReady,
  managedTwilioReady,
}: Props) {
  const [showExistingTwilio, setShowExistingTwilio] = useState(false);
  const accountAction = connectClientAccount.bind(null, token, provider.key);
  const [accountState, submitAccount, accountPending] = useActionState(
    accountAction,
    initialFormState,
  );
  const [phoneState, submitPhone, phonePending] = useActionState(
    provisionClientPhoneNumber.bind(null, token),
    initialFormState,
  );
  const [googleState, submitGoogle, googlePending] = useActionState(
    startClientGoogleConnect.bind(null, token),
    initialFormState,
  );

  return (
    <article className="rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{provider.title}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{provider.tagline}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Connected
          </span>
        ) : null}
      </div>

      {connected ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Verified. No additional access is needed.
        </div>
      ) : provider.key === "google_calendar" ? (
        <form action={submitGoogle} className="mt-5">
          <Button type="submit" disabled={googlePending || !googleReady}>
            <ExternalLink aria-hidden="true" />
            {googlePending ? "Opening Google..." : "Connect Google Calendar"}
          </Button>
          {!googleReady ? (
            <p className="mt-2 text-xs text-amber-800">
              {supportName} is still preparing Google Calendar access. No action is required from you yet.
            </p>
          ) : null}
          <ResultMessage state={googleState} />
        </form>
      ) : provider.key === "twilio" ? (
        <div className="mt-5 space-y-4">
          <form action={submitPhone} className="rounded-md border bg-secondary/30 p-4">
            <div className="flex items-center gap-2">
              <PhoneCall className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-medium">Set up a business phone number</h3>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Recommended. {productName} creates and configures the number. Forward your current business line to it or port the number later.
            </p>
            <div className="mt-3 max-w-48 space-y-1.5">
              <Label htmlFor="managed-area-code">Preferred area code</Label>
              <Input
                id="managed-area-code"
                name="areaCode"
                inputMode="numeric"
                maxLength={3}
                placeholder="312"
                aria-invalid={Boolean(phoneState.fieldErrors?.areaCode)}
              />
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Checkbox name="confirmPurchase" value="yes" />
              I authorize the purchase of a Twilio phone number for this business.
            </label>
            <Button type="submit" className="mt-3" disabled={phonePending || !managedTwilioReady}>
              <PhoneCall aria-hidden="true" />
              {phonePending ? "Provisioning..." : "Provision phone number"}
            </Button>
            {!managedTwilioReady ? (
              <p className="mt-2 text-xs text-amber-800">
                {supportName} is still preparing phone service. No action is required from you yet.
              </p>
            ) : null}
            <ResultMessage state={phoneState} />
          </form>

          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium"
            onClick={() => setShowExistingTwilio((value) => !value)}
          >
            <ChevronDown className={cn("size-4 transition-transform", showExistingTwilio && "rotate-180")} aria-hidden="true" />
            Already have a Twilio account?
          </button>
          {showExistingTwilio ? (
            <CredentialForm
              provider={provider}
              state={accountState}
              pending={accountPending}
              action={submitAccount}
            />
          ) : null}
        </div>
      ) : (
        <CredentialForm
          provider={provider}
          state={accountState}
          pending={accountPending}
          action={submitAccount}
        />
      )}
    </article>
  );
}

function CredentialForm({
  provider,
  state,
  pending,
  action,
}: {
  provider: PilotProviderMeta;
  state: typeof initialFormState;
  pending: boolean;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="mt-5 space-y-3">
      <div className="rounded-md bg-secondary/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {provider.whereToGet}
      </div>
      {provider.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={`${provider.key}-${field.name}`}>{field.label}</Label>
          {field.options ? (
            <select
              id={`${provider.key}-${field.name}`}
              name={field.name}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <Input
              id={`${provider.key}-${field.name}`}
              name={field.name}
              type={field.secret ? "password" : "text"}
              placeholder={field.placeholder}
              autoComplete="off"
              aria-invalid={Boolean(state.fieldErrors?.[field.name])}
            />
          )}
          {state.fieldErrors?.[field.name] ? (
            <p className="text-xs text-destructive">{state.fieldErrors[field.name]}</p>
          ) : null}
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        <PlugZap aria-hidden="true" />
        {pending ? "Verifying..." : `Verify and connect ${provider.title}`}
      </Button>
      <ResultMessage state={state} />
    </form>
  );
}
