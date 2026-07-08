"use client";

import { useActionState } from "react";

import { saveKnowledgeProfile } from "@/app/partner/clients/[clientId]/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeProfile } from "@/lib/knowledge/profile";
import { initialFormState } from "@/lib/forms/state";
import { cn } from "@/lib/utils";

const FIELDS: {
  name: keyof KnowledgeProfile & string;
  label: string;
  help: string;
  rows?: number;
}[] = [
  {
    name: "business_description",
    label: "Business description",
    help: "One short paragraph: who the business is and what it does.",
  },
  {
    name: "services_offered",
    label: "Services offered",
    help: "The services the AI may claim the business performs. Nothing else will be promised.",
  },
  {
    name: "service_areas",
    label: "Service areas",
    help: "Cities/regions served. The AI will not promise service outside them.",
  },
  {
    name: "business_hours",
    label: "Business hours (description)",
    help: "Human-readable hours, e.g. \"Mon–Fri 8am–5pm, emergency service 24/7\".",
  },
  {
    name: "emergency_rules",
    label: "Emergency rules",
    help: "What counts as an emergency and what the AI should do (e.g. flag urgent, tell caller to shut off water).",
  },
  {
    name: "pricing_disclaimer",
    label: "Pricing / quote disclaimer",
    help: "What the AI says when pricing comes up. It never invents prices.",
  },
  {
    name: "booking_rules",
    label: "Booking rules",
    help: "Constraints for appointments (lead time, duration notes, who confirms).",
  },
  {
    name: "escalation_rules",
    label: "Escalation rules",
    help: "When the AI must hand off to a human and who to flag.",
  },
  {
    name: "ai_disclosure",
    label: "AI disclosure text",
    help: "How the assistant introduces itself (shown in chat; spoken on calls per the mode below).",
  },
];

export function KnowledgeForm({
  clientId,
  profile,
  canManage,
}: {
  clientId: string;
  profile: KnowledgeProfile | null;
  canManage: boolean;
}) {
  const bound = saveKnowledgeProfile.bind(null, clientId);
  const [state, formAction, pending] = useActionState(bound, initialFormState);

  const faqText = (profile?.faq ?? [])
    .map((entry) => `${entry.q} :: ${entry.a}`)
    .join("\n");

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Your role cannot edit the AI knowledge for this client.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {FIELDS.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Textarea
              id={field.name}
              name={field.name}
              rows={field.rows ?? 3}
              defaultValue={(profile?.[field.name] as string | null) ?? ""}
            />
            <p className="text-xs text-muted-foreground">{field.help}</p>
          </div>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="faq">Approved FAQ</Label>
          <Textarea
            id="faq"
            name="faq"
            rows={5}
            defaultValue={faqText}
            placeholder={"Do you offer free estimates? :: Yes, estimates are free.\nAre you licensed? :: Yes, licensed and insured."}
          />
          <p className="text-xs text-muted-foreground">
            One entry per line: <code>Question :: Answer</code>. Only these
            answers are given verbatim.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="booking_hours_start">Booking start (hour)</Label>
              <Input
                id="booking_hours_start"
                name="booking_hours_start"
                type="number"
                min={0}
                max={23}
                defaultValue={profile?.booking_hours_start ?? 9}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking_hours_end">Booking end (hour)</Label>
              <Input
                id="booking_hours_end"
                name="booking_hours_end"
                type="number"
                min={1}
                max={24}
                defaultValue={profile?.booking_hours_end ?? 17}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointment_duration_minutes">
                Visit length (min)
              </Label>
              <Input
                id="appointment_duration_minutes"
                name="appointment_duration_minutes"
                type="number"
                min={15}
                max={480}
                step={15}
                defaultValue={profile?.appointment_duration_minutes ?? 60}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The slot proposer only offers appointments inside this window, in
            the client&apos;s timezone.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="voice_disclosure_mode">
              AI phone disclosure mode
            </Label>
            <Select
              id="voice_disclosure_mode"
              name="voice_disclosure_mode"
              defaultValue={profile?.voice_disclosure_mode ?? "explicit"}
              className="max-w-56"
            >
              <option value="explicit">Explicit (recommended)</option>
              <option value="minimal">Minimal (where legal)</option>
              <option value="off">Off — AI never answers calls</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              Explicit means the AI introduces itself as an AI assistant and
              offers a human. Confirm legal requirements before using minimal.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save knowledge"}
        </Button>
        {state.message ? (
          <p
            className={cn(
              "text-sm",
              state.status === "error" ? "text-destructive" : "text-emerald-700",
            )}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
