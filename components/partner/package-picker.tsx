"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import {
  assignPackageToClient,
  createCustomPackageForClient,
  type PackageAssignmentResult,
} from "@/app/partner/clients/[clientId]/setup/actions";
import { createStarterPackages } from "@/app/partner/packages/actions";
import { PackageDeploymentResult } from "@/components/partner/package-deployment-result";
import { PackageForm } from "@/components/partner/package-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CAPABILITIES, type CapabilityKey } from "@/lib/packages/capabilities";
import { cn } from "@/lib/utils";

// Step 1 of client setup: "Which package did you sell this client?"
// Options are the partner's reusable packages, plus a custom one-off
// package built inline when the sold deal doesn't match anything saved.

export type PackageOption = {
  id: string;
  name: string;
  description: string | null;
  capabilityKeys: CapabilityKey[];
  isCustomForThisClient: boolean;
};

type PackagePickerProps = {
  clientId: string;
  options: PackageOption[];
  currentPackageId: string | null;
  canManage: boolean;
  collapsedByDefault?: boolean;
};

export function PackagePicker({
  clientId,
  options,
  currentPackageId,
  canManage,
  collapsedByDefault = false,
}: PackagePickerProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsedByDefault);
  const [selectedId, setSelectedId] = useState<string | null>(currentPackageId);
  const [showCustom, setShowCustom] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assignmentResult, setAssignmentResult] =
    useState<PackageAssignmentResult | null>(null);
  const [starterMessage, setStarterMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const boundCustomCreate = createCustomPackageForClient.bind(null, clientId);

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Your role cannot change this client&apos;s package.
      </p>
    );
  }

  if (!isExpanded) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsExpanded(true)}
      >
        Deploy, redeploy, or create a custom package
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      {options.length === 0 ? (
        <div className="rounded-md border bg-secondary/40 px-4 py-4 text-sm leading-6">
          <p>
            You have no saved packages yet. Create the three common tiers —
            Basic Automation, AI Assist, Full AI Operations — then pick the
            one you sold. You can rename or retoggle them any time under{" "}
            <span className="font-medium">Packages</span>.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createStarterPackages();
                  setStarterMessage(result.message ?? null);
                })
              }
            >
              {isPending ? "Creating…" : "Create the three starter packages"}
            </Button>
            {starterMessage ? (
              <span className="text-xs text-muted-foreground">
                {starterMessage}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {options.map((option) => {
            const isSelected = selectedId === option.id;
            const isCurrent = currentPackageId === option.id;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedId(option.id);
                  setMessage(null);
                  setAssignmentResult(null);
                }}
                className={cn(
                  "rounded-md border p-4 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "bg-background hover:bg-secondary/40",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{option.name}</span>
                  {option.isCustomForThisClient ? (
                    <Badge variant="outline">Custom for this client</Badge>
                  ) : null}
                  {isCurrent ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-800"
                    >
                      <Check className="size-3" aria-hidden="true" />
                      Current
                    </Badge>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {option.capabilityKeys.map((key) => (
                    <Badge key={key} variant="outline">
                      {CAPABILITIES[key].label}
                    </Badge>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {options.length > 0 ? (
          <Button
            type="button"
            disabled={isPending || !selectedId}
            onClick={() => {
              if (!selectedId) {
                return;
              }

              startTransition(async () => {
                const result = await assignPackageToClient(
                  clientId,
                  selectedId,
                );
                setAssignmentResult(result);
                setMessage(result.message ?? null);
              });
            }}
          >
            {isPending
              ? "Deploying…"
              : selectedId === currentPackageId
                ? "Redeploy package"
                : currentPackageId
                ? "Switch to this package"
                : "Deploy this package"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowCustom((value) => !value)}
        >
          {showCustom ? "Hide custom package form" : "Create a custom package"}
        </Button>
      </div>

      {message ? (
        <p
          className={cn(
            "text-sm",
            assignmentResult?.status === "error"
              ? "text-destructive"
              : "text-emerald-700",
          )}
        >
          {message}
        </p>
      ) : null}

      {assignmentResult?.deployment ? (
        <PackageDeploymentResult deployment={assignmentResult.deployment} />
      ) : null}

      {showCustom ? (
        <div className="rounded-md border bg-secondary/30 p-4">
          <p className="text-sm font-semibold">
            Custom package for this client only
          </p>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Use this when the sold deal doesn&apos;t match a saved package.
            It is created and assigned in one step.
          </p>
          <PackageForm
            action={boundCustomCreate}
            submitLabel="Create & deploy custom package"
            compact
          />
        </div>
      ) : null}
    </div>
  );
}
