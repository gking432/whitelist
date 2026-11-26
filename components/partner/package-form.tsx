"use client";

import { useActionState } from "react";

import { PackageDeploymentResult } from "@/components/partner/package-deployment-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "@/lib/packages/capabilities";
import { initialFormState, type FormState } from "@/lib/forms/state";
import type { PackageDeploymentSummary } from "@/lib/packages/deployment";
import { cn } from "@/lib/utils";

type PackageFormProps = {
  // Server action bound by the caller (create, update, or create-custom).
  action: (previousState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string;
  initialCapabilities?: CapabilityKey[];
  // Hide name/description for tight embeds (custom package keeps them).
  compact?: boolean;
};

const statusBadges: Record<string, { label: string; className: string } | null> =
  {
    available: null,
    preview: {
      label: "Partly ready",
      className: "border-sky-200 bg-sky-50 text-sky-800",
    },
    coming_soon: {
      label: "Coming soon",
      className: "border-slate-200 bg-slate-100 text-slate-600",
    },
  };

export function PackageForm({
  action,
  submitLabel,
  initialName = "",
  initialDescription = "",
  initialCapabilities = [],
  compact = false,
}: PackageFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const initialSet = new Set(initialCapabilities);
  const deployment = (state as FormState & {
    deployment?: PackageDeploymentSummary;
  }).deployment;

  return (
    <form action={formAction} className="space-y-5">
      <div className={cn("grid gap-4", compact ? "" : "sm:grid-cols-2")}>
        <div className="space-y-1.5">
          <Label htmlFor="package-name">Package name</Label>
          <Input
            id="package-name"
            name="name"
            defaultValue={initialName}
            placeholder="e.g. AI Assist"
            aria-invalid={Boolean(state.fieldErrors?.name)}
          />
          {state.fieldErrors?.name ? (
            <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="package-description">
            Description <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="package-description"
            name="description"
            defaultValue={initialDescription}
            rows={2}
            placeholder="What this offer includes, in your own words."
          />
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold">What&apos;s included</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Toggle the capabilities this package sells. Items marked
          &quot;Coming soon&quot; can be sold ahead — setup will say plainly
          what works today.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {CAPABILITY_KEYS.map((key) => {
            const capability = CAPABILITIES[key];
            const badge = statusBadges[capability.status];

            return (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 transition-colors hover:bg-secondary/40"
              >
                <Checkbox
                  name={`cap_${key}`}
                  defaultChecked={initialSet.has(key)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">
                      {capability.label}
                    </span>
                    {badge ? (
                      <Badge variant="outline" className={badge.className}>
                        {badge.label}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {capability.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
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
      {deployment ? <PackageDeploymentResult deployment={deployment} /> : null}
    </form>
  );
}
