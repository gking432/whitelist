export const PARTNER_ONBOARDING_STEPS = [
  "agency",
  "branding",
  "team",
  "integrations",
  "plan",
] as const;

export type PartnerOnboardingStep =
  (typeof PARTNER_ONBOARDING_STEPS)[number];

export type PartnerOnboardingRecord = {
  id: string;
  partner_id: string;
  status: "not_started" | "in_progress" | "completed";
  current_step: PartnerOnboardingStep;
  integrations_reviewed_at: string | null;
  plan_key: string | null;
  setup_fee_cents: number | null;
  monthly_fee_cents: number | null;
  included_active_clients: number | null;
  additional_client_fee_cents: number | null;
  billing_status:
    | "not_configured"
    | "pending"
    | "active"
    | "past_due"
    | "cancelled";
  plan_confirmed_at: string | null;
  completed_at: string | null;
};

export const PARTNER_V1_PLAN = {
  key: "partner_v1",
  name: "White-label partner",
  setupFeeCents: 100_000,
  monthlyFeeCents: 50_000,
  includedActiveClients: 10,
  additionalClientFeeCents: null,
} as const;

export function isPartnerOnboardingStep(
  value: string | undefined,
): value is PartnerOnboardingStep {
  return PARTNER_ONBOARDING_STEPS.includes(value as PartnerOnboardingStep);
}

export function onboardingStepIndex(step: PartnerOnboardingStep): number {
  return PARTNER_ONBOARDING_STEPS.indexOf(step);
}

export function furthestOnboardingStep(
  current: PartnerOnboardingStep,
  candidate: PartnerOnboardingStep,
): PartnerOnboardingStep {
  return onboardingStepIndex(candidate) > onboardingStepIndex(current)
    ? candidate
    : current;
}

export function requestedOnboardingStep(
  requested: string | undefined,
  current: PartnerOnboardingStep,
  completed: boolean,
): PartnerOnboardingStep {
  if (!isPartnerOnboardingStep(requested)) return current;
  if (completed) return requested;

  return onboardingStepIndex(requested) <= onboardingStepIndex(current)
    ? requested
    : current;
}

export function partnerOnboardingIsComplete(
  onboarding: Pick<PartnerOnboardingRecord, "status" | "completed_at"> | null,
): boolean {
  return onboarding?.status === "completed" && Boolean(onboarding.completed_at);
}

export function formatPlanPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
