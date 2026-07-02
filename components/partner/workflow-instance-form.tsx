"use client";

import { useActionState } from "react";

import { updateWorkflowInstance } from "@/app/partner/clients/[clientId]/workflows/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RUNTIME_MODES } from "@/lib/clients/constants";
import { formatEnum } from "@/lib/format";
import { initialFormState } from "@/lib/forms/state";

export type SettingsField = {
  key: string;
  label: string;
  type: "text" | "textarea";
  help?: string;
};

type WorkflowInstanceFormProps = {
  clientId: string;
  instanceId: string;
  runtimeMode: string;
  approvalPolicy: { requires_approval?: boolean };
  settings: Record<string, unknown>;
  settingsFields: SettingsField[];
  templateRequiresApproval: boolean;
};

export function WorkflowInstanceForm({
  clientId,
  instanceId,
  runtimeMode,
  approvalPolicy,
  settings,
  settingsFields,
  templateRequiresApproval,
}: WorkflowInstanceFormProps) {
  const boundAction = updateWorkflowInstance.bind(null, clientId, instanceId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialFormState,
  );

  const approvalDefaultValue =
    approvalPolicy?.requires_approval === undefined
      ? "template_default"
      : approvalPolicy.requires_approval
        ? "always"
        : "never";

  return (
    <form action={formAction} className="space-y-5">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}
      {state.status === "success" && state.message ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="runtime_mode">Runtime mode</Label>
          <Select
            id="runtime_mode"
            name="runtime_mode"
            className="mt-1.5"
            defaultValue={runtimeMode}
          >
            {RUNTIME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatEnum(mode)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Sandbox and dry run never produce external side effects. Paused
            suppresses runs entirely.
          </p>
        </div>
        <div>
          <Label htmlFor="approval_policy">Approval policy</Label>
          <Select
            id="approval_policy"
            name="approval_policy"
            className="mt-1.5"
            defaultValue={approvalDefaultValue}
          >
            <option value="template_default">
              Template default (
              {templateRequiresApproval ? "approval required" : "no approval"})
            </option>
            <option value="always">Always require approval</option>
            <option value="never">Never require approval</option>
          </Select>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            High-risk workflows always require approval in live mode.
          </p>
        </div>
      </div>

      {settingsFields.length > 0 ? (
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">
            Client-specific settings
          </legend>
          {settingsFields.map((field) => {
            const value =
              typeof settings[field.key] === "string"
                ? (settings[field.key] as string)
                : "";

            return (
              <div key={field.key}>
                <Label htmlFor={`setting_${field.key}`}>{field.label}</Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={`setting_${field.key}`}
                    name={`setting_${field.key}`}
                    className="mt-1.5"
                    defaultValue={value}
                  />
                ) : (
                  <Input
                    id={`setting_${field.key}`}
                    name={`setting_${field.key}`}
                    className="mt-1.5"
                    defaultValue={value}
                  />
                )}
                {field.help ? (
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {field.help}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save configuration"}
      </Button>
    </form>
  );
}
