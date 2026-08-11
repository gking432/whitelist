"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";

import {
  requestIntegration,
  type RequestIntegrationState,
} from "@/app/partner/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: RequestIntegrationState = { status: "idle", message: "" };

export function IntegrationRequestForm({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(requestIntegration, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="request-client">Client</Label>
          <select id="request-client" name="client_id" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">Agency-wide or not decided</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="request-category">Type</Label>
          <select id="request-category" name="category" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="crm">CRM / field service</option>
            <option value="phone">Phone or texting</option>
            <option value="calendar">Email or calendar</option>
            <option value="accounting">Accounting or payments</option>
            <option value="lead_source">Lead source or reviews</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="application-name">Application name</Label>
          <Input id="application-name" name="application_name" placeholder="Example: Jobber" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="application-url">Application website</Label>
          <Input id="application-url" name="application_url" type="url" placeholder="https://..." />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="trigger-description">What happens first?</Label>
        <textarea id="trigger-description" name="trigger_description" required className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="A customer calls, completes a form, books a job..." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="desired-result">What should our system do?</Label>
        <textarea id="desired-result" name="desired_result" required className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Create the customer, save notes, schedule the job..." />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor="current-systems">Other systems involved</Label>
          <Input id="current-systems" name="current_systems" placeholder="Twilio, Google Calendar, QuickBooks" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="request-priority">Priority</Label>
          <select id="request-priority" name="priority" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="blocking">Blocking launch</option>
          </select>
        </div>
      </div>
      {state.message ? <p className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700"}>{state.message}</p> : null}
      <Button type="submit" disabled={pending}><Send aria-hidden="true" />{pending ? "Submitting..." : "Submit request"}</Button>
    </form>
  );
}
