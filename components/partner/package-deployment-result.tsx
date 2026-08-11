"use client";

import { useState } from "react";
import { Check, CircleAlert, Copy, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PackageDeploymentSummary } from "@/lib/packages/deployment";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex min-w-0 gap-2">
        <Input
          value={value}
          readOnly
          aria-label={label}
          className="min-w-0 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          title={`Copy ${label.toLowerCase()}`}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

export function PackageDeploymentResult({
  deployment,
}: {
  deployment: PackageDeploymentSummary;
}) {
  return (
    <div className="space-y-4 border-l-2 border-primary/40 pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <Workflow className="size-4 text-primary" aria-hidden="true" />
        <p className="text-sm font-semibold">Sandbox deployment complete</p>
        <Badge
          variant="outline"
          className={
            deployment.status === "ready"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }
        >
          {deployment.status === "ready" ? "Ready to test" : "Connections needed"}
        </Badge>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        {deployment.provisionedWorkflowKeys.length} workflow
        {deployment.provisionedWorkflowKeys.length === 1 ? "" : "s"} provisioned;
        {` ${deployment.createdWorkflowCount} newly created. `}
        {deployment.automationPackNames.length} package automation
        {deployment.automationPackNames.length === 1 ? "" : "s"} installed.
      </p>

      {deployment.automationPackNames.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {deployment.automationPackNames.map((name) => (
            <Badge key={name} variant="outline">
              {name}
            </Badge>
          ))}
        </div>
      ) : null}

      {deployment.missingIntegrationLabels.length > 0 ? (
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Connect before go-live: {deployment.missingIntegrationLabels.join(", ")}.
          </p>
        </div>
      ) : null}

      {deployment.bridge ? (
        <div className="space-y-3 border-t pt-4">
          <div>
            <p className="text-sm font-semibold">Zapier / n8n / Make intake</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Use the endpoint as the destination URL and send the token in the
              <code className="mx-1 rounded bg-secondary px-1 py-0.5">
                x-webhook-token
              </code>
              header.
            </p>
          </div>
          <CopyField label="Endpoint URL" value={deployment.bridge.endpointUrl} />
          {deployment.bridge.oneTimeToken ? (
            <>
              <CopyField
                label="One-time webhook token"
                value={deployment.bridge.oneTimeToken}
              />
              <p className="text-xs font-medium text-amber-800">
                This token is shown only in this deployment result.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This client already has a package intake bridge. Rotate its token
              from Integrations if the credential is no longer available.
            </p>
          )}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => window.location.reload()}
      >
        Continue to setup
      </Button>
    </div>
  );
}
