"use client";

import { useActionState, useState } from "react";

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
    label: "Business hours",
    help: 'For example, "Mon–Fri 8am–5pm, emergency service 24/7".',
  },
  {
    name: "emergency_rules",
    label: "Emergency rules",
    help: "What counts as an emergency and what the AI should do (e.g. flag urgent, tell caller to shut off water).",
  },
  {
    name: "pricing_disclaimer",
    label: "What to say about pricing",
    help: "What the AI says when pricing comes up. It never invents prices.",
  },
  {
    name: "booking_rules",
    label: "Booking rules",
    help: "Constraints for appointments (lead time, duration notes, who confirms).",
  },
  {
    name: "escalation_rules",
    label: "When to get a person",
    help: "When the AI must hand off to a human and who to flag.",
  },
  {
    name: "ai_disclosure",
    label: "How the assistant introduces itself",
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

  const [faqs, setFaqs] = useState(() =>
    (profile?.faq ?? []).map((entry, index) => ({ ...entry, id: index })),
  );
  const faqJson = JSON.stringify(faqs.map(({ q, a }) => ({ q, a })));

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Your role cannot edit the AI knowledge for this client.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-xl border bg-secondary/30 p-4 text-sm leading-6">
        Tell the assistant what this business does and how to help its
        customers. Use everyday language, just as you would when training a new
        team member.
      </div>
      {[
        {
          title: "About the business",
          names: [
            "business_description",
            "services_offered",
            "service_areas",
            "business_hours",
          ],
        },
        {
          title: "How to help customers",
          names: [
            "emergency_rules",
            "pricing_disclaimer",
            "booking_rules",
            "escalation_rules",
            "ai_disclosure",
          ],
        },
      ].map((group) => (
        <fieldset key={group.title} className="space-y-4">
          <legend className="mb-4 text-base font-semibold">
            {group.title}
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            {FIELDS.filter((field) => group.names.includes(field.name)).map(
              (field) => (
                <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <Textarea
                    id={field.name}
                    name={field.name}
                    rows={field.rows ?? 3}
                    defaultValue={
                      (profile?.[field.name] as string | null) ?? ""
                    }
                  />
                  <p className="text-xs text-muted-foreground">{field.help}</p>
                </div>
              ),
            )}
          </div>
        </fieldset>
      ))}
      <section className="space-y-4 border-t pt-5">
        <div>
          <h3 className="font-semibold">Common questions & answers</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Give the assistant the answers you want customers to hear.
          </p>
        </div>
        <input type="hidden" name="faq_json" value={faqJson} />
        {faqs.map((entry, index) => (
          <div
            key={entry.id}
            className="space-y-3 rounded-xl border bg-secondary/20 p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Question {index + 1}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove question ${index + 1}`}
                onClick={() =>
                  setFaqs((current) =>
                    current.filter((item) => item.id !== entry.id),
                  )
                }
              >
                Remove
              </Button>
            </div>
            <div>
              <Label htmlFor={`faq-question-${entry.id}`}>
                Customer question
              </Label>
              <Input
                className="mt-1.5"
                id={`faq-question-${entry.id}`}
                value={entry.q}
                required
                placeholder="Do you offer free estimates?"
                onChange={(event) =>
                  setFaqs((current) =>
                    current.map((item) =>
                      item.id === entry.id
                        ? { ...item, q: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </div>
            <div>
              <Label htmlFor={`faq-answer-${entry.id}`}>Your answer</Label>
              <Textarea
                className="mt-1.5"
                id={`faq-answer-${entry.id}`}
                value={entry.a}
                required
                placeholder="Yes, we offer free estimates. Call us to arrange a visit."
                onChange={(event) =>
                  setFaqs((current) =>
                    current.map((item) =>
                      item.id === entry.id
                        ? { ...item, a: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={faqs.length >= 50}
          onClick={() =>
            setFaqs((current) => [
              ...current,
              {
                id: Math.max(-1, ...current.map((item) => item.id)) + 1,
                q: "",
                a: "",
              },
            ])
          }
        >
          Add a question
        </Button>
      </section>
      <details className="ns-disclosure rounded-xl border bg-card">
        <summary>Appointment times & phone introduction</summary>
        <div className="space-y-4 px-5 pb-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="booking_hours_start">First booking time</Label>
              <Select
                id="booking_hours_start"
                name="booking_hours_start"
                defaultValue={profile?.booking_hours_start ?? 9}
              >
                {Array.from({ length: 24 }, (_, index) => index + 0).map(
                  (hour) => (
                    <option key={hour} value={hour}>
                      {hour === 24
                        ? "Midnight (end of day)"
                        : `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`}
                    </option>
                  ),
                )}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking_hours_end">Last booking ends by</Label>
              <Select
                id="booking_hours_end"
                name="booking_hours_end"
                defaultValue={profile?.booking_hours_end ?? 17}
              >
                {Array.from({ length: 24 }, (_, index) => index + 1).map(
                  (hour) => (
                    <option key={hour} value={hour}>
                      {hour === 24
                        ? "Midnight (end of day)"
                        : `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`}
                    </option>
                  ),
                )}
              </Select>
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
      </details>

      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save business knowledge"}
        </Button>
        {state.message ? (
          <p
            className={cn(
              "text-sm",
              state.status === "error"
                ? "text-destructive"
                : "text-emerald-700",
            )}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
