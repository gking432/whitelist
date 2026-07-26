"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  MonitorCog,
  Package,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  COMMON_TIMEZONES,
  type ClientExperienceMode,
} from "@/lib/clients/constants";
import { initialFormState, type FormState } from "@/lib/forms/state";
import { cn } from "@/lib/utils";

export type ClientOnboardingPackage = {
  id: string;
  name: string;
  description: string | null;
  capabilities: Array<{ key: string; label: string }>;
  requirements: Array<{
    id: string;
    label: string;
    purpose: string;
    recommended: string;
  }>;
  staffRuntimes: Array<{
    runtime: string;
    label: string;
    detail: string;
  }>;
};

type ClientOnboardingFormProps = {
  action: (previousState: FormState, formData: FormData) => Promise<FormState>;
  packages: ClientOnboardingPackage[];
};

const steps = [
  { number: 1, label: "Business", icon: Building2 },
  { number: 2, label: "Package", icon: Package },
  { number: 3, label: "Experience", icon: MonitorCog },
  { number: 4, label: "Review", icon: ClipboardCheck },
] as const;

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1.5 text-xs text-destructive">{message}</p>
  ) : null;
}

export function ClientOnboardingForm({
  action,
  packages,
}: ClientOnboardingFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    action,
    initialFormState,
  );
  const [step, setStep] = useState(1);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [experienceMode, setExperienceMode] =
    useState<ClientExperienceMode | null>(null);
  const [clientName, setClientName] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const errors = state.fieldErrors ?? {};
  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.id === selectedPackageId) ?? null,
    [packages, selectedPackageId],
  );
  const visibleRequirements =
    experienceMode === "northstar_crm"
      ? (selectedPackage?.requirements.filter(
          (requirement) => requirement.id !== "crm",
        ) ?? [])
      : (selectedPackage?.requirements ?? []);

  function advance() {
    setValidationMessage(null);

    if (step === 1) {
      const panel = formRef.current?.querySelector<HTMLElement>(
        '[data-onboarding-panel="1"]',
      );
      const controls = panel?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >("input, select");

      for (const control of controls ?? []) {
        if (!control.checkValidity()) {
          control.reportValidity();
          return;
        }
      }

      const formData = formRef.current
        ? new FormData(formRef.current)
        : null;
      const email = String(formData?.get("primary_contact_email") ?? "").trim();
      const phone = String(formData?.get("primary_contact_phone") ?? "").trim();

      if (!email && !phone) {
        setValidationMessage(
          "Add the primary contact's email or phone number.",
        );
        return;
      }
    }

    if (step === 2 && !selectedPackageId) {
      setValidationMessage("Choose the package this client purchased.");
      return;
    }

    if (step === 3 && !experienceMode) {
      setValidationMessage("Choose where this client will work.");
      return;
    }

    setStep((current) => Math.min(4, current + 1));
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="status" value="onboarding" />
      <input type="hidden" name="default_runtime_mode" value="sandbox" />
      <input type="hidden" name="client_portal_enabled" value="on" />
      <input
        type="hidden"
        name="crm_operating_mode"
        value={
          experienceMode === "northstar_crm"
            ? "primary_crm"
            : "external_crm_only"
        }
      />

      <nav
        aria-label="Client onboarding progress"
        className="grid grid-cols-4 overflow-hidden rounded-lg border bg-card"
      >
        {steps.map((item, index) => {
          const Icon = item.icon;
          const active = item.number === step;
          const complete = item.number < step;

          return (
            <button
              key={item.number}
              type="button"
              disabled={item.number > step}
              onClick={() => item.number < step && setStep(item.number)}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5 text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:px-2 sm:py-3",
                index > 0 && "border-l",
                active && "bg-primary/8 text-primary",
                complete && "text-foreground hover:bg-secondary/50",
                !active && !complete && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  active && "border-primary bg-primary text-primary-foreground",
                  complete && "border-emerald-600 bg-emerald-600 text-white",
                )}
              >
                {complete ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  item.number
                )}
              </span>
              <Icon className="hidden size-4 sm:block" aria-hidden="true" />
              <span className="text-[10px] sm:text-xs">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      <fieldset
        data-onboarding-panel="1"
        disabled={isPending}
        className={cn(
          "rounded-lg border bg-card p-5 sm:p-6",
          step !== 1 && "hidden",
        )}
      >
        <legend className="sr-only">Business and primary contact</legend>
        <h2 className="font-semibold">Business and primary contact</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          The basic information Northstar uses throughout setup, alerts, and
          client access.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              name="name"
              className="mt-1.5"
              placeholder="Summit Home Services"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              required
            />
            <FieldError message={errors.name} />
          </div>
          <div>
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              name="industry"
              className="mt-1.5"
              placeholder="Roofing, HVAC, plumbing"
              required
            />
            <FieldError message={errors.industry} />
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              id="timezone"
              name="timezone"
              className="mt-1.5"
              defaultValue="America/Chicago"
            >
              {COMMON_TIMEZONES.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </Select>
            <FieldError message={errors.timezone} />
          </div>
          <div>
            <Label htmlFor="website_url">Website</Label>
            <Input
              id="website_url"
              name="website_url"
              className="mt-1.5"
              placeholder="https://"
              inputMode="url"
            />
            <FieldError message={errors.website_url} />
          </div>
        </div>

        <div className="mt-6 border-t pt-5">
          <h3 className="text-sm font-semibold">Primary client contact</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="primary_contact_name">Name</Label>
              <Input
                id="primary_contact_name"
                name="primary_contact_name"
                className="mt-1.5"
                placeholder="Client owner"
              />
            </div>
            <div>
              <Label htmlFor="primary_contact_email">Email</Label>
              <Input
                id="primary_contact_email"
                name="primary_contact_email"
                type="email"
                className="mt-1.5"
                placeholder="owner@business.com"
              />
              <FieldError message={errors.primary_contact_email} />
            </div>
            <div>
              <Label htmlFor="primary_contact_phone">Phone</Label>
              <Input
                id="primary_contact_phone"
                name="primary_contact_phone"
                className="mt-1.5"
                placeholder="(555) 555-0123"
                inputMode="tel"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Email or phone is required. This does not send an invitation yet.
          </p>
        </div>
      </fieldset>

      <fieldset
        data-onboarding-panel="2"
        disabled={isPending}
        className={cn(
          "rounded-lg border bg-card p-5 sm:p-6",
          step !== 2 && "hidden",
        )}
      >
        <legend className="sr-only">Choose the sold package</legend>
        <h2 className="font-semibold">What did this client purchase?</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          The package determines the AI tools, automations, connections, and
          tests in the client&apos;s setup plan.
        </p>

        <div className="mt-5 grid gap-3">
          {packages.map((pkg) => (
            <label
              key={pkg.id}
              className={cn(
                "block cursor-pointer rounded-lg border p-4 transition-colors",
                selectedPackageId === pkg.id
                  ? "border-primary bg-primary/5"
                  : "hover:bg-secondary/40",
              )}
            >
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="package_id"
                  value={pkg.id}
                  checked={selectedPackageId === pkg.id}
                  onChange={() => setSelectedPackageId(pkg.id)}
                  className="mt-1 size-4 accent-primary"
                  required
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {pkg.name}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                    {pkg.description ?? "No package description."}
                  </span>
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    {pkg.capabilities.map((capability) => (
                      <span
                        key={capability.key}
                        className="rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        {capability.label}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
        <FieldError message={errors.package_id} />
      </fieldset>

      <fieldset
        data-onboarding-panel="3"
        disabled={isPending}
        className={cn(
          "rounded-lg border bg-card p-5 sm:p-6",
          step !== 3 && "hidden",
        )}
      >
        <legend className="sr-only">Choose the client experience</legend>
        <h2 className="font-semibold">Where will the client work?</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Their package stays the same. This choice decides whether Northstar
          is their operating system or works behind their existing tools.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-colors",
              experienceMode === "northstar_crm"
                ? "border-primary bg-primary/5"
                : "hover:bg-secondary/40",
            )}
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="client_experience_mode"
                value="northstar_crm"
                checked={experienceMode === "northstar_crm"}
                onChange={() => setExperienceMode("northstar_crm")}
                className="mt-1 size-4 accent-primary"
                required
              />
              <span>
                <span className="block text-sm font-semibold">
                  Northstar CRM
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Northstar is the client&apos;s home base for contacts,
                  pipeline, tasks, calls, marketing, and reports.
                </span>
              </span>
            </span>
          </label>

          <label
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-colors",
              experienceMode === "background_only"
                ? "border-primary bg-primary/5"
                : "hover:bg-secondary/40",
            )}
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="client_experience_mode"
                value="background_only"
                checked={experienceMode === "background_only"}
                onChange={() => setExperienceMode("background_only")}
                className="mt-1 size-4 accent-primary"
                required
              />
              <span>
                <span className="block text-sm font-semibold">
                  Existing systems
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  AI and automations run behind the client&apos;s current CRM,
                  phone, email, and calendar. Their portal only shows service
                  health and activity.
                </span>
              </span>
            </span>
          </label>
        </div>
        <FieldError message={errors.client_experience_mode} />
      </fieldset>

      <section
        data-onboarding-panel="4"
        className={cn(
          "rounded-lg border bg-card p-5 sm:p-6",
          step !== 4 && "hidden",
        )}
      >
        <h2 className="font-semibold">Review the setup plan</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Creating the workspace keeps everything in sandbox. Nothing contacts
          customers or changes an external system.
        </p>

        <dl className="mt-5 grid gap-4 border-y py-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Client</dt>
            <dd className="mt-1 text-sm font-semibold">
              {clientName || "Unnamed client"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Package</dt>
            <dd className="mt-1 text-sm font-semibold">
              {selectedPackage?.name ?? "Not selected"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Home base</dt>
            <dd className="mt-1 text-sm font-semibold">
              {experienceMode === "northstar_crm"
                ? "Northstar CRM"
                : "Existing systems"}
            </dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">External accounts needed</h3>
            {visibleRequirements.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This setup does not require an external provider account.
              </p>
            ) : (
              <div className="mt-2 divide-y rounded-md border">
                {visibleRequirements.map((requirement) => (
                  <div key={requirement.id} className="px-3 py-3">
                    <p className="text-sm font-medium">{requirement.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {requirement.purpose}
                    </p>
                    <p className="mt-1 text-xs font-medium">
                      Recommended: {requirement.recommended}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold">Client-side software</h3>
            {(selectedPackage?.staffRuntimes.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing needs to be installed on client computers.
              </p>
            ) : (
              <div className="mt-2 divide-y rounded-md border">
                {selectedPackage?.staffRuntimes.map((runtime) => (
                  <div key={runtime.runtime} className="px-3 py-3">
                    <p className="text-sm font-medium">{runtime.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {runtime.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Next, Northstar opens the client&apos;s Package &amp; Setup page.
          You will provision the package in sandbox, connect these accounts,
          test each included feature, and launch only after everything passes.
        </div>
      </section>

      {validationMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {validationMessage}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={step === 1 || isPending}
          onClick={() => {
            setValidationMessage(null);
            setStep((current) => Math.max(1, current - 1));
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>

        {step < 4 ? (
          <Button type="button" onClick={advance}>
            Continue
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending ? "Creating workspace..." : "Create client workspace"}
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  );
}
