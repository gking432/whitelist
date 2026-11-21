"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";

import { createPartnerAccount } from "@/app/control/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormState } from "@/lib/forms/state";

export function NewPartnerForm() {
  const [state, action, pending] = useActionState(
    createPartnerAccount,
    initialFormState,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="agency-name">Agency name</Label>
          <Input id="agency-name" name="agency_name" required />
          {state.fieldErrors?.agency_name ? (
            <p className="text-xs text-destructive">
              {state.fieldErrors.agency_name}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="owner-name">Owner name</Label>
          <Input id="owner-name" name="owner_name" required />
          {state.fieldErrors?.owner_name ? (
            <p className="text-xs text-destructive">
              {state.fieldErrors.owner_name}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="owner-email">Owner email</Label>
          <Input id="owner-email" name="owner_email" type="email" required />
          {state.fieldErrors?.owner_email ? (
            <p className="text-xs text-destructive">
              {state.fieldErrors.owner_email}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Creates the white-label workspace and sends the owner directly into onboarding. Billing remains separate.
        </p>
        <Button type="submit" disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? "Creating..." : "Create and invite"}
        </Button>
      </div>
      {state.message ? (
        <p
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-emerald-700"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
