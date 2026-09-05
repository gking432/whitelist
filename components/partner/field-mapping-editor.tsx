"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import {
  createConnectionFieldMapping,
  deleteConnectionFieldMapping,
} from "@/app/partner/clients/[clientId]/integrations/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatEnum } from "@/lib/format";
import { initialFormState } from "@/lib/forms/state";
import {
  CANONICAL_OBJECT_TYPES,
  CONNECTOR_MAPPING_DIRECTIONS,
  CONNECTOR_MAPPING_TRANSFORMS,
} from "@/lib/integrations/connectors/types";

export type FieldMappingRow = {
  id: string;
  object_type: string;
  direction: string;
  native_field: string;
  external_field: string;
  transform_key: string | null;
  default_value: unknown;
  is_required: boolean;
  is_active: boolean;
};

type Props = {
  clientId: string;
  connectionId: string;
  mappings: FieldMappingRow[];
  canManage: boolean;
};

export function FieldMappingEditor({
  clientId,
  connectionId,
  mappings,
  canManage,
}: Props) {
  const router = useRouter();
  const [removeState, setRemoveState] = useState<string | null>(null);
  const [isRemoving, startRemoving] = useTransition();
  const action = createConnectionFieldMapping.bind(null, clientId, connectionId);
  const [state, formAction, isSaving] = useActionState(action, initialFormState);

  function remove(mappingId: string) {
    setRemoveState(null);
    startRemoving(async () => {
      const result = await deleteConnectionFieldMapping(
        clientId,
        connectionId,
        mappingId,
      );
      if (result.status === "error") setRemoveState(result.message ?? "Delete failed.");
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h3 className="text-sm font-semibold">Field mappings</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Match client workspace fields to this provider&apos;s API fields.
        </p>
      </div>

      {mappings.length ? (
        <div className="divide-y">
          {mappings.map((mapping) => (
            <div
              key={mapping.id}
              className="grid gap-3 px-5 py-3 text-sm sm:grid-cols-[7rem_6rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <div>
                <p className="font-medium">{formatEnum(mapping.object_type)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatEnum(mapping.direction)}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {mapping.transform_key
                  ? formatEnum(mapping.transform_key)
                  : "No transform"}
                {mapping.is_required ? " · Required" : ""}
              </div>
              <code className="min-w-0 overflow-x-auto font-mono text-xs">
                {mapping.native_field} → {mapping.external_field}
              </code>
              {canManage ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title="Remove field mapping"
                  aria-label="Remove field mapping"
                  disabled={isRemoving}
                  onClick={() => remove(mapping.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          Default connector fields are active.
        </p>
      )}

      {canManage ? (
        <form action={formAction} className="space-y-4 border-t px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mapping-object">Record</Label>
              <Select id="mapping-object" name="object_type" defaultValue="customer">
                {CANONICAL_OBJECT_TYPES.map((value) => (
                  <option key={value} value={value}>{formatEnum(value)}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mapping-direction">Direction</Label>
              <Select id="mapping-direction" name="direction" defaultValue="both">
                {CONNECTOR_MAPPING_DIRECTIONS.map((value) => (
                  <option key={value} value={value}>{formatEnum(value)}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mapping-transform">Transform</Label>
              <Select id="mapping-transform" name="transform_key" defaultValue="">
                <option value="">None</option>
                {CONNECTOR_MAPPING_TRANSFORMS.map((value) => (
                  <option key={value} value={value}>{formatEnum(value)}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mapping-native">Workspace field</Label>
              <Input id="mapping-native" name="native_field" placeholder="customer_type" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mapping-external">Provider field</Label>
              <Input id="mapping-external" name="external_field" placeholder="customFields.customerType" required />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="mapping-default">Default value</Label>
              <Input id="mapping-default" name="default_value" placeholder="Optional" />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox name="is_required" />
              Required
            </label>
          </div>
          {state.message ? (
            <p className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-emerald-700"} role={state.status === "error" ? "alert" : "status"}>
              {state.message}
            </p>
          ) : null}
          {removeState ? <p className="text-xs text-destructive" role="alert">{removeState}</p> : null}
          <Button type="submit" size="sm" disabled={isSaving}>
            {isSaving ? "Adding..." : "Add mapping"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
