"use client";

import { useState, useTransition } from "react";

import { enablePackageWorkflows } from "@/app/partner/clients/[clientId]/setup/actions";
import { Button } from "@/components/ui/button";

export function EnablePackageWorkflowsButton({
  clientId,
  label,
}: {
  clientId: string;
  label: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await enablePackageWorkflows(clientId);
            setMessage(result.message ?? null);
          })
        }
      >
        {isPending ? "Enabling…" : label}
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
