"use client";

import { useActionState, useState } from "react";
import { Mail, MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/forms/state";
import { initialFormState } from "@/lib/forms/state";
import type { ClientNotificationPreference } from "@/lib/notifications/client";

export function NotificationPreferencesForm({
  action,
  initial,
  email,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  initial: ClientNotificationPreference;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialFormState,
  );
  const [emailEnabled, setEmailEnabled] = useState(initial.email_enabled);
  const [smsEnabled, setSmsEnabled] = useState(initial.sms_enabled);

  return (
    <form action={formAction} className="space-y-5">
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-emerald-700"
          }
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex min-h-20 items-start gap-3 rounded-md border p-4">
          <Checkbox
            name="email_enabled"
            checked={emailEnabled}
            onChange={(event) => setEmailEnabled(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4 text-muted-foreground" />
              Email alerts
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        </label>

        <div className="rounded-md border p-4">
          <label className="flex items-start gap-3">
            <Checkbox
              name="sms_enabled"
              checked={smsEnabled}
              onChange={(event) => setSmsEnabled(event.target.checked)}
            />
            <span className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareText className="size-4 text-muted-foreground" />
              SMS alerts
            </span>
          </label>
          <Label htmlFor="sms_phone" className="sr-only">
            SMS phone number
          </Label>
          <Input
            id="sms_phone"
            name="sms_phone"
            defaultValue={initial.sms_phone ?? ""}
            disabled={!smsEnabled || pending}
            placeholder="+13125551234"
            inputMode="tel"
            className="mt-3"
          />
          {state.fieldErrors?.sms_phone ? (
            <p className="mt-1.5 text-xs text-destructive">
              {state.fieldErrors.sms_phone}
            </p>
          ) : null}
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <Checkbox
          name="critical_only"
          defaultChecked={initial.critical_only}
          disabled={pending}
        />
        Send external alerts only for critical events
      </label>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save delivery settings"}
      </Button>
    </form>
  );
}
