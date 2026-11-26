"use client";
import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import {
  BUSINESS_GOALS,
  INDUSTRIES,
  inferIndustry,
} from "@/lib/business/catalog";
import type { BusinessProfile } from "@/lib/business/types";
import { buttonClass, inputClass, secondaryClass } from "./record-editor";
import Link from "next/link";
import { OnboardingProgress } from "./onboarding-progress";
export function BusinessSetup({
  profile,
  busy,
  isNew,
  onSave,
}: {
  profile: BusinessProfile;
  busy: boolean;
  isNew: boolean;
  onSave: (profile: BusinessProfile) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(profile);
  const [step, setStep] = useState(isNew ? 0 : 1);
  const [saved, setSaved] = useState(false);
  const change = (key: keyof BusinessProfile, value: string) => {
    setSaved(false);
    setDraft((p) => ({ ...p, [key]: value }));
  };
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-6 py-4"><OnboardingProgress current="profile" /></div>
      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="bg-primary/5 p-6 sm:p-9">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </span>
          <h2 className="mt-6 max-w-xs text-2xl font-semibold tracking-tight">
            A workspace that understands your business.
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Start with what you do and what you want help with. We’ll suggest
            useful capabilities and show you how to get each one working.
          </p>
          <ol className="mt-8 space-y-5">
            {[
              "Describe your business",
              "Choose your priorities",
              "Add the facts your assistants need",
            ].map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-xs ${i <= step ? "bg-primary text-white" : "border bg-card text-muted-foreground"}`}
                >
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <p className="mt-8 text-xs leading-6 text-muted-foreground">
            Your saved description, services, hours, and policies also update
            the knowledge used by your business assistants.
          </p>
        </aside>
        <form
          className="space-y-6 p-6 sm:p-9"
          onSubmit={async (event) => {
            event.preventDefault();
            if (step === 0) {
              setStep(1);
              return;
            }
            setSaved(await onSave(draft));
          }}
        >
          {step === 0 ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Start here
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  What kind of business do you run?
                </h3>
              </div>
              <label className="block space-y-2 text-sm font-medium">
                Tell us a little about it
                <textarea
                  required
                  minLength={5}
                  maxLength={3000}
                  rows={4}
                  className={inputClass}
                  value={draft.description}
                  onChange={(e) => {
                    setSaved(false);
                    const description = e.target.value;
                    setDraft((p) => ({
                      ...p,
                      description,
                      industry: inferIndustry(description),
                    }));
                  }}
                  placeholder="For example: I run a golf shop selling used equipment and offering regripping services."
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {INDUSTRIES.map((industry) => (
                  <button
                    type="button"
                    key={industry.key}
                    onClick={() => change("industry", industry.key)}
                    aria-pressed={draft.industry === industry.key}
                    className={`rounded-xl border p-3 text-left transition ${draft.industry === industry.key ? "border-primary bg-primary/5" : "hover:bg-secondary"}`}
                  >
                    <span className="text-sm font-medium">
                      {industry.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {industry.description}
                    </span>
                  </button>
                ))}
              </div>
              <button className={buttonClass}>
                Continue
                <ArrowRight className="size-4" />
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Make it yours
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  What would make your week easier?
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {BUSINESS_GOALS.map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    aria-pressed={draft.goals.includes(goal)}
                    onClick={() => {
                      setSaved(false);
                      setDraft((p) => ({
                        ...p,
                        goals: p.goals.includes(goal)
                          ? p.goals.filter((g) => g !== goal)
                          : [...p.goals, goal],
                      }));
                    }}
                    className={`rounded-full border px-3 py-2 text-xs font-medium transition ${draft.goals.includes(goal) ? "border-primary bg-primary text-white" : "hover:bg-secondary"}`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
              <label className="block space-y-2 text-sm font-medium">
                Business description
                <textarea
                  required
                  minLength={5}
                  maxLength={3000}
                  rows={3}
                  value={draft.description}
                  onChange={(e) => change("description", e.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium">
                  Business type
                  <select
                    value={draft.industry}
                    onChange={(e) => change("industry", e.target.value)}
                    className={inputClass}
                  >
                    {INDUSTRIES.map((i) => (
                      <option value={i.key} key={i.key}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Currency
                  <select
                    value={draft.currency}
                    onChange={(e) => change("currency", e.target.value)}
                    className={inputClass}
                  >
                    {["USD", "CAD", "GBP", "EUR", "AUD"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              {(
                [
                  {
                    key: "services",
                    label: "Products & services",
                    placeholder: "What you offer, with any approved prices",
                  },
                  {
                    key: "audience",
                    label: "Your customers",
                    placeholder: "Who you help and where",
                  },
                  {
                    key: "hours",
                    label: "Business hours",
                    placeholder: "Opening hours and time zone",
                  },
                  {
                    key: "policies",
                    label: "Business rules",
                    placeholder:
                      "Booking, purchasing, cancellations, and anything to confirm with you",
                  },
                ] as const
              ).map((field) => (
                <label
                  key={field.key}
                  className="block space-y-2 text-sm font-medium"
                >
                  {field.label}
                  <textarea
                    rows={2}
                    value={draft[field.key]}
                    onChange={(e) => change(field.key, e.target.value)}
                    className={inputClass}
                    placeholder={field.placeholder}
                  />
                </label>
              ))}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium">
                  Website
                  <input
                    type="url"
                    value={draft.website}
                    onChange={(e) => change("website", e.target.value)}
                    className={inputClass}
                    placeholder="https://"
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Brand voice
                  <input
                    value={draft.tone}
                    maxLength={200}
                    onChange={(e) => change("tone", e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="flex flex-wrap justify-between gap-3 border-t pt-5">
                {isNew ? (
                  <button
                    type="button"
                    onClick={() => setStep(0)}
                    className={secondaryClass}
                  >
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <button disabled={busy} className={buttonClass}>
                  {busy
                    ? "Saving…"
                    : isNew
                      ? "Save & see recommendations"
                      : "Save business settings"}
                  <ArrowRight className="size-4" />
                </button>
              </div>
              {saved ? <p role="status" className="text-sm leading-6">Business details saved. <Link href="/client/onboarding" className="font-medium underline">Review facts and choose authority</Link>.</p> : null}
            </>
          )}
        </form>
      </div>
    </section>
  );
}
