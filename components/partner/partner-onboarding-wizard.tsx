"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CreditCard,
  ExternalLink,
  Palette,
  PlugZap,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import {
  completePartnerOnboarding,
  finishPartnerIntegrationsStep,
  finishPartnerTeamStep,
  invitePartnerTeamMember,
  saveOnboardingBranding,
  savePartnerAgencyDetails,
} from "@/app/partner/onboarding/actions";
import {
  BrandingForm,
  type BrandingFormValue,
} from "@/components/partner/branding-form";
import { PartnerTwilioForm } from "@/components/partner/partner-twilio-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { initialFormState, type FormState } from "@/lib/forms/state";
import {
  formatPlanPrice,
  onboardingStepIndex,
  partnerTwilioConnectionIsReady,
  PARTNER_ONBOARDING_STEPS,
  PARTNER_V1_PLAN,
  type PartnerOnboardingStep,
} from "@/lib/onboarding/partner";
import { cn } from "@/lib/utils";

type PartnerTeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

type PartnerOnboardingWizardProps = {
  step: PartnerOnboardingStep;
  furthestStep: PartnerOnboardingStep;
  partner: {
    name: string;
    websiteUrl: string;
    supportEmail: string;
    supportPhone: string;
  };
  branding: BrandingFormValue;
  team: PartnerTeamMember[];
  agencyId: string;
  twilioConnection: {
    status: string;
    credentialStatus: string;
    healthSummary: string | null;
    accountSid: string | null;
    lastSuccessAt: string | null;
  } | null;
};

const stepMeta: Record<
  PartnerOnboardingStep,
  { label: string; shortLabel: string; icon: typeof Building2 }
> = {
  agency: {
    label: "Agency details",
    shortLabel: "Agency",
    icon: Building2,
  },
  branding: {
    label: "White-label brand",
    shortLabel: "Brand",
    icon: Palette,
  },
  team: {
    label: "Agency team",
    shortLabel: "Team",
    icon: UsersRound,
  },
  integrations: {
    label: "Phone & agency tools",
    shortLabel: "Phone",
    icon: PlugZap,
  },
  plan: {
    label: "Partner plan",
    shortLabel: "Plan",
    icon: CreditCard,
  },
};

function fieldError(message?: string) {
  return message ? (
    <p className="mt-1.5 text-xs text-destructive">{message}</p>
  ) : null;
}

function ActionMessage({ state }: { state: FormState }) {
  if (!state.message) return null;

  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        state.status === "error"
          ? "border-destructive/25 bg-destructive/5 text-destructive"
          : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      {state.message}
    </p>
  );
}

function AgencyStep({
  partner,
}: {
  partner: PartnerOnboardingWizardProps["partner"];
}) {
  const [state, action, pending] = useActionState(
    savePartnerAgencyDetails,
    initialFormState,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-6">
      <ActionMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="agency_name">Agency name</Label>
          <Input
            id="agency_name"
            name="agency_name"
            defaultValue={partner.name}
            placeholder="Brightline Growth"
            autoComplete="organization"
            className="mt-1.5"
            aria-invalid={Boolean(errors.agency_name)}
          />
          {fieldError(errors.agency_name)}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="website_url">Agency website</Label>
          <Input
            id="website_url"
            name="website_url"
            type="url"
            defaultValue={partner.websiteUrl}
            placeholder="https://agency.com"
            autoComplete="url"
            className="mt-1.5"
            aria-invalid={Boolean(errors.website_url)}
          />
          {fieldError(errors.website_url)}
        </div>
        <div>
          <Label htmlFor="support_email">Client support email</Label>
          <Input
            id="support_email"
            name="support_email"
            type="email"
            defaultValue={partner.supportEmail}
            placeholder="support@agency.com"
            autoComplete="email"
            className="mt-1.5"
            aria-invalid={Boolean(errors.support_email)}
          />
          {fieldError(errors.support_email)}
        </div>
        <div>
          <Label htmlFor="support_phone">Client support phone</Label>
          <Input
            id="support_phone"
            name="support_phone"
            type="tel"
            defaultValue={partner.supportPhone}
            placeholder="(555) 555-0123"
            autoComplete="tel"
            className="mt-1.5"
          />
        </div>
      </div>
      <div className="flex justify-end border-t pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save and continue"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

function TeamStep({ team }: { team: PartnerTeamMember[] }) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    invitePartnerTeamMember,
    initialFormState,
  );
  const [continueState, continueAction, continuePending] = useActionState(
    finishPartnerTeamStep,
    initialFormState,
  );
  const errors = inviteState.fieldErrors ?? {};

  return (
    <div className="space-y-7">
      <section>
        <h3 className="text-sm font-semibold">Workspace access</h3>
        <div className="mt-3 overflow-hidden rounded-lg border">
          {team.map((member) => (
            <div
              key={member.id}
              className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {member.role.replaceAll("_", " ")}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    member.status === "active"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : ""
                  }
                >
                  {member.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form action={inviteAction} className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-sm font-semibold">Invite a team member</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Optional. You can add or change your team later.
          </p>
        </div>
        <ActionMessage state={inviteState} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="full_name">Name</Label>
            <Input
              id="full_name"
              name="full_name"
              placeholder="Jordan Lee"
              className="mt-1.5"
              aria-invalid={Boolean(errors.full_name)}
            />
            {fieldError(errors.full_name)}
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="jordan@agency.com"
              className="mt-1.5"
              aria-invalid={Boolean(errors.email)}
            />
            {fieldError(errors.email)}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="role">Partner role</Label>
            <Select
              id="role"
              name="role"
              defaultValue="partner_implementer"
              className="mt-1.5"
              aria-invalid={Boolean(errors.role)}
            >
              <option value="partner_admin">Admin</option>
              <option value="partner_implementer">Implementer</option>
              <option value="partner_viewer">Viewer</option>
            </Select>
            {fieldError(errors.role)}
          </div>
        </div>
        <Button type="submit" variant="outline" disabled={invitePending}>
          <UsersRound aria-hidden="true" />
          {invitePending ? "Sending..." : "Send invitation"}
        </Button>
      </form>

      <form
        action={continueAction}
        className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <ActionMessage state={continueState} />
        <Button type="submit" className="sm:ml-auto" disabled={continuePending}>
          {continuePending ? "Saving..." : "Continue"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

function IntegrationsStep({
  agencyId,
  twilioConnection,
}: {
  agencyId: string;
  twilioConnection: PartnerOnboardingWizardProps["twilioConnection"];
}) {
  const [state, action, pending] = useActionState(
    finishPartnerIntegrationsStep,
    initialFormState,
  );
  const twilioReady = partnerTwilioConnectionIsReady(
    twilioConnection
      ? {
          status: twilioConnection.status,
          credential_status: twilioConnection.credentialStatus,
          last_success_at: twilioConnection.lastSuccessAt,
        }
      : null,
  );

  return (
    <div className="space-y-6">
      <PartnerTwilioForm connection={twilioConnection} compact />

      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Optional agency tools</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Your agency can use the same CRM and automations you sell. This is
            separate from client setup and can wait until later.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/partner/clients/${agencyId}/integrations`}>
            Manage connections
            <ExternalLink aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <ActionMessage state={state} />
      <form
        action={action}
        className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-xs text-muted-foreground">
          {twilioReady
            ? "Twilio is verified. Optional agency tools can be connected at any time."
            : "Connect and verify the Twilio billing account above to continue."}
        </p>
        <Button type="submit" disabled={pending || !twilioReady}>
          {pending ? "Saving..." : "Continue"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

function PlanStep() {
  const [state, action, pending] = useActionState(
    completePartnerOnboarding,
    initialFormState,
  );

  return (
    <form action={action} className="space-y-6">
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-start justify-between gap-4 border-b bg-secondary/35 px-5 py-4">
          <div>
            <p className="font-semibold">{PARTNER_V1_PLAN.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              One plan with the full partner platform.
            </p>
          </div>
          <Badge variant="outline" className="whitespace-nowrap">
            Partner v1
          </Badge>
        </div>
        <dl className="divide-y">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <dt className="text-sm text-muted-foreground">
              One-time activation
            </dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatPlanPrice(PARTNER_V1_PLAN.setupFeeCents)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <dt className="text-sm text-muted-foreground">
              Platform subscription
            </dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatPlanPrice(PARTNER_V1_PLAN.monthlyFeeCents)}/month
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <dt className="text-sm text-muted-foreground">
              Active client accounts included
            </dt>
            <dd className="text-sm font-semibold tabular-nums">
              {PARTNER_V1_PLAN.includedActiveClients}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <dt className="text-sm text-muted-foreground">
              Additional active clients
            </dt>
            <dd className="text-right text-sm font-medium">
              Rate finalized before billing
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-secondary/35 px-4 py-4">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium">No payment is collected today</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Billing is not connected yet. This confirms the current plan
            structure and opens your partner workspace.
          </p>
        </div>
      </div>

      <ActionMessage state={state} />
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-6">
        <Checkbox
          name="plan_acknowledged"
          aria-invalid={Boolean(state.fieldErrors?.plan_acknowledged)}
          className="mt-1"
        />
        <span>
          I understand the current partner plan and that additional-client
          pricing will be confirmed before billing begins.
        </span>
      </label>
      {fieldError(state.fieldErrors?.plan_acknowledged)}

      <div className="flex justify-end border-t pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Finishing setup..." : "Finish onboarding"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

export function PartnerOnboardingWizard({
  step,
  furthestStep,
  partner,
  branding,
  team,
  agencyId,
  twilioConnection,
}: PartnerOnboardingWizardProps) {
  const activeIndex = onboardingStepIndex(step);
  const furthestIndex = onboardingStepIndex(furthestStep);
  const meta = stepMeta[step];
  const StepIcon = meta.icon;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              N
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                Partner setup
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {partner.name}
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Step {activeIndex + 1} of {PARTNER_ONBOARDING_STEPS.length}
          </span>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] md:py-10">
        <nav aria-label="Onboarding progress">
          <ol className="grid grid-cols-5 overflow-hidden rounded-lg border bg-card md:block">
            {PARTNER_ONBOARDING_STEPS.map((item, index) => {
              const itemMeta = stepMeta[item];
              const Icon = itemMeta.icon;
              const active = item === step;
              const complete = index < furthestIndex;
              const available = index <= furthestIndex;
              const content = (
                <>
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md border",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : complete
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "bg-card text-muted-foreground",
                    )}
                  >
                    {complete ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Icon className="size-3.5" aria-hidden="true" />
                    )}
                  </span>
                  <span className="hidden min-w-0 md:block">
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {itemMeta.label}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-1 truncate text-[10px] md:hidden",
                      active ? "font-semibold text-primary" : "text-muted-foreground",
                    )}
                  >
                    {itemMeta.shortLabel}
                  </span>
                </>
              );

              return (
                <li key={item}>
                  {available ? (
                    <Link
                      href={`/partner/onboarding?step=${item}`}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "flex min-w-0 flex-col items-center gap-1 border-r px-1 py-2 last:border-r-0 md:flex-row md:gap-3 md:border-b md:border-r-0 md:px-3 md:py-3 md:last:border-b-0",
                        active && "bg-primary/5",
                      )}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-col items-center gap-1 border-r px-1 py-2 opacity-60 last:border-r-0 md:flex-row md:gap-3 md:border-b md:border-r-0 md:px-3 md:py-3 md:last:border-b-0">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0">
          <div className="rounded-lg border bg-card ns-surface">
            <header className="border-b px-5 py-5 sm:px-7">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <StepIcon className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Step {activeIndex + 1}
                  </p>
                  <h1 className="mt-0.5 text-xl font-semibold">{meta.label}</h1>
                </div>
              </div>
            </header>
            <div className="px-5 py-6 sm:px-7">
              {step === "agency" ? <AgencyStep partner={partner} /> : null}
              {step === "branding" ? (
                <BrandingForm
                  action={saveOnboardingBranding}
                  initial={branding}
                  submitLabel="Save and continue"
                />
              ) : null}
              {step === "team" ? <TeamStep team={team} /> : null}
              {step === "integrations" ? (
                <IntegrationsStep
                  agencyId={agencyId}
                  twilioConnection={twilioConnection}
                />
              ) : null}
              {step === "plan" ? <PlanStep /> : null}
            </div>
          </div>

          {activeIndex > 0 ? (
            <Button asChild variant="ghost" size="sm" className="mt-3">
              <Link
                href={`/partner/onboarding?step=${PARTNER_ONBOARDING_STEPS[activeIndex - 1]}`}
              >
                <ArrowLeft aria-hidden="true" />
                Previous step
              </Link>
            </Button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
