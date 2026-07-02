"use client";

import { useState, useTransition } from "react";

import { enableWorkflowTemplate } from "@/app/partner/clients/[clientId]/workflows/actions";
import { Button } from "@/components/ui/button";

type EnableTemplateButtonProps = {
  clientId: string;
  templateId: string;
};

export function EnableTemplateButton({
  clientId,
  templateId,
}: EnableTemplateButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <Button
        type="button"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await enableWorkflowTemplate(clientId, templateId);
            setMessage(result.message ?? null);
            setIsError(result.status === "error");
          })
        }
      >
        {isPending ? "Enabling…" : "Enable"}
      </Button>
      {message ? (
        <p
          className={
            isError
              ? "mt-2 text-xs text-destructive"
              : "mt-2 text-xs text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
