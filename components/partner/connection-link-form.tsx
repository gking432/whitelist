"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";

import type { ConnectionLinkState } from "@/app/partner/clients/[clientId]/connections/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { initialFormState } from "@/lib/forms/state";
import { PILOT_PROVIDERS } from "@/lib/integrations/pilot";

const connectionInitialState: ConnectionLinkState = initialFormState;

type Props = {
  action: (
    previousState: ConnectionLinkState,
    formData: FormData,
  ) => Promise<ConnectionLinkState>;
  hasActiveLink: boolean;
};

export function ConnectionLinkForm({ action, hasActiveLink }: Props) {
  const [state, formAction, pending] = useActionState(
    action,
    connectionInitialState,
  );
  const [copied, setCopied] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">CRM</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "", label: "Northstar CRM" },
            { value: "hubspot", label: PILOT_PROVIDERS.hubspot.title },
            { value: "gohighlevel", label: PILOT_PROVIDERS.gohighlevel.title },
          ].map((option, index) => (
            <label
              key={option.label}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="crm_provider"
                value={option.value}
                defaultChecked={index === 0}
                className="size-4 accent-primary"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Field-service system</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "", label: "None / built-in CRM" },
            { value: "jobber", label: "Jobber" },
            { value: "housecall_pro", label: "Housecall Pro" },
            { value: "servicetitan", label: "ServiceTitan" },
            { value: "workiz", label: "Workiz" },
          ].map((option, index) => (
            <label key={option.label} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="field_service_provider" value={option.value} defaultChecked={index === 0} className="size-4 accent-primary" />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Email and calendar</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "google_workspace", label: PILOT_PROVIDERS.google_workspace.title },
            { value: "microsoft_365", label: PILOT_PROVIDERS.microsoft_365.title },
            { value: "", label: "Built-in calendar + Resend" },
          ].map((option, index) => (
            <label
              key={option.label}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="productivity_provider"
                value={option.value}
                defaultChecked={index === 0}
                className="size-4 accent-primary"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Accounting and payments</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[PILOT_PROVIDERS.quickbooks_online, PILOT_PROVIDERS.stripe, PILOT_PROVIDERS.square].map((provider) => (
            <label key={provider.key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <Checkbox name="providers" value={provider.key} />
              <span>{provider.title}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Call tracking</legend>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm sm:max-w-72">
          <Checkbox name="providers" value="callrail" />
          <span>{PILOT_PROVIDERS.callrail.title}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Business phone system</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { value: "twilio", label: "Managed phone service (Twilio)" },
            { value: "ringcentral", label: PILOT_PROVIDERS.ringcentral.title },
            { value: "dialpad", label: PILOT_PROVIDERS.dialpad.title },
            { value: "openphone", label: PILOT_PROVIDERS.openphone.title },
          ].map((option, index) => (
            <label key={option.value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="phone_provider" value={option.value} defaultChecked={index === 0} className="size-4 accent-primary" />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Managed Twilio supports AI answering and the full live scheduling coach. Retained systems support caller screen-pop, CRM matching, logging, and the post-call AI features their APIs expose.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Optional email sending</legend>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm sm:max-w-72">
          <Checkbox name="providers" value="resend" />
          <span>{PILOT_PROVIDERS.resend.title}</span>
        </label>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {hasActiveLink ? <RefreshCw aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {pending
          ? "Creating secure link..."
          : hasActiveLink
            ? "Replace setup link"
            : "Create client setup link"}
      </Button>

      {state.setupUrl ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">Send this link to the client</p>
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={state.setupUrl}
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Copy setup link"
              onClick={async () => {
                await navigator.clipboard.writeText(state.setupUrl!);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span className="sr-only">Copy setup link</span>
            </Button>
          </div>
        </div>
      ) : null}

      {state.message && !state.setupUrl ? (
        <p className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
