"use client";

import { PersonalAssistantPreferencesForm } from "./preferences-form";
import { usePersonalAssistantPreferences } from "./preferences-provider";
export function PersonalAssistantOnboardingQuestion() {
  const state = usePersonalAssistantPreferences();
  if (!state) return null;
  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Optional personal assistant preference" data-personal-assistant-onboarding>
    <PersonalAssistantPreferencesForm />
    <p className="mt-4 text-xs leading-6 text-slate-500">This choice is personal to your account in this business. Your business manager uses shared business records. You can continue reviewing your business without answering.</p>
  </section>;
}
