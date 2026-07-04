"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CLIENT_STATUSES,
  COMMON_TIMEZONES,
  CRM_OPERATING_MODES,
  RUNTIME_MODES,
  type ClientBusinessRecord,
} from "@/lib/clients/constants";
import { formatEnum } from "@/lib/format";
import { initialFormState, type FormState } from "@/lib/forms/state";

type ClientBusinessFormProps = {
  action: (previousState: FormState, formData: FormData) => Promise<FormState>;
  client?: ClientBusinessRecord;
  submitLabel: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-1.5 text-xs text-destructive">{message}</p>;
}

export function ClientBusinessForm({
  action,
  client,
  submitLabel,
}: ClientBusinessFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    initialFormState,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-8">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}
      {state.status === "success" && state.message ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {state.message}
        </div>
      ) : null}

      <fieldset className="space-y-4" disabled={isPending}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Business information
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Client name</Label>
            <Input
              id="name"
              name="name"
              className="mt-1.5"
              defaultValue={client?.name}
              placeholder="Summit Home Services"
              required
            />
            <FieldError message={errors.name} />
          </div>
          <div>
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              name="industry"
              className="mt-1.5"
              defaultValue={client?.industry ?? ""}
              placeholder="Roofing, HVAC, plumbing…"
              required
            />
            <FieldError message={errors.industry} />
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              id="timezone"
              name="timezone"
              className="mt-1.5"
              defaultValue={client?.timezone ?? "America/Chicago"}
            >
              {COMMON_TIMEZONES.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </Select>
            <FieldError message={errors.timezone} />
          </div>
          <div>
            <Label htmlFor="website_url">Website</Label>
            <Input
              id="website_url"
              name="website_url"
              className="mt-1.5"
              defaultValue={client?.website_url ?? ""}
              placeholder="https://"
              inputMode="url"
            />
            <FieldError message={errors.website_url} />
          </div>
          {client ? (
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                name="status"
                className="mt-1.5"
                defaultValue={client.status}
              >
                {CLIENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatEnum(status)}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.status} />
            </div>
          ) : (
            <input type="hidden" name="status" value="onboarding" />
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={isPending}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Primary contact
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="primary_contact_name">Name</Label>
            <Input
              id="primary_contact_name"
              name="primary_contact_name"
              className="mt-1.5"
              defaultValue={client?.primary_contact_name ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="primary_contact_email">Email</Label>
            <Input
              id="primary_contact_email"
              name="primary_contact_email"
              type="email"
              className="mt-1.5"
              defaultValue={client?.primary_contact_email ?? ""}
            />
            <FieldError message={errors.primary_contact_email} />
          </div>
          <div>
            <Label htmlFor="primary_contact_phone">Phone</Label>
            <Input
              id="primary_contact_phone"
              name="primary_contact_phone"
              className="mt-1.5"
              defaultValue={client?.primary_contact_phone ?? ""}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A contact email or phone is required so operational issues can reach
          the client.
        </p>
      </fieldset>

      <fieldset className="space-y-4" disabled={isPending}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Operating modes
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="crm_operating_mode">CRM operating mode</Label>
            <Select
              id="crm_operating_mode"
              name="crm_operating_mode"
              className="mt-1.5"
              defaultValue={client?.crm_operating_mode ?? "webhook_only"}
            >
              {CRM_OPERATING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {formatEnum(mode)}
                </option>
              ))}
            </Select>
            <FieldError message={errors.crm_operating_mode} />
          </div>
          <div>
            <Label htmlFor="default_runtime_mode">Default runtime mode</Label>
            <Select
              id="default_runtime_mode"
              name="default_runtime_mode"
              className="mt-1.5"
              defaultValue={client?.default_runtime_mode ?? "sandbox"}
            >
              {RUNTIME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {formatEnum(mode)}
                </option>
              ))}
            </Select>
            <FieldError message={errors.default_runtime_mode} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={isPending}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Access and permissions
        </legend>
        <label className="flex items-start gap-3 rounded-xl border p-4 transition-colors has-checked:border-primary/40 has-checked:bg-primary/4">
          <Checkbox
            name="client_portal_enabled"
            defaultChecked={client?.client_portal_enabled ?? false}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">
              Enable client portal
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Client users can sign in to see their business&apos;s automation
              status, approvals, and integration health.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border p-4 transition-colors has-checked:border-primary/40 has-checked:bg-primary/4">
          <Checkbox
            name="partner_can_edit_client_data"
            defaultChecked={client?.partner_can_edit_client_data ?? false}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">
              Allow partner edits to client operational data
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Off by default. Partner users can always configure integrations
              and inspect logs; this grants edits to client-owned records, and
              every edit is audited.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
