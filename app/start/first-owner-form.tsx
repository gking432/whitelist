"use client";
import { useActionState } from "react";
import { createFirstOwnerBusiness } from "./actions";
import { initialFirstOwnerFormState } from "./state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
export function FirstOwnerForm({ requestKey }: { requestKey: string }) {
  const [state, action, pending] = useActionState(createFirstOwnerBusiness, initialFirstOwnerFormState);
  return <form action={action} className="mt-8 space-y-5">
    <input type="hidden" name="key" value={requestKey} />
    <div className="space-y-2"><Label htmlFor="business-name">Business name</Label><Input id="business-name" name="name" autoComplete="organization" minLength={2} maxLength={100} required disabled={pending} aria-invalid={Boolean(state.fields?.name)} aria-describedby={state.fields?.name ? "name-error" : undefined} />{state.fields?.name ? <p id="name-error" className="text-sm text-destructive">{state.fields.name}</p> : null}</div>
    <div className="space-y-2"><Label htmlFor="business-description">Business description</Label><Textarea id="business-description" name="description" minLength={10} maxLength={2000} placeholder="What do you do, and who do you help?" required disabled={pending} aria-invalid={Boolean(state.fields?.description)} aria-describedby={state.fields?.description ? "description-error" : undefined} />{state.fields?.description ? <p id="description-error" className="text-sm text-destructive">{state.fields.description}</p> : null}</div>
    <div className="space-y-2"><Label htmlFor="business-timezone">Timezone</Label><Input id="business-timezone" name="timezone" defaultValue="America/Chicago" maxLength={100} required disabled={pending} autoComplete="off" aria-invalid={Boolean(state.fields?.timezone)} aria-describedby="timezone-help" /><p id="timezone-help" className="text-xs text-muted-foreground">Use a timezone such as America/Chicago, America/New_York or Europe/London.</p>{state.fields?.timezone ? <p className="text-sm text-destructive">{state.fields.timezone}</p> : null}</div>
    {state.message ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{state.message}</p> : null}
    <Button type="submit" disabled={pending} className="min-h-11 w-full">{pending ? "Creating your business…" : "Create my business"}</Button>
  </form>;
}
