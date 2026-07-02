"use client";

import { useState, useTransition } from "react";

import { setWorkflowInstanceStatus } from "@/app/partner/clients/[clientId]/workflows/actions";
import { Button } from "@/components/ui/button";

type WorkflowStatusButtonsProps = {
  clientId: string;
  instanceId: string;
  status: string;
};

export function WorkflowStatusButtons({
  clientId,
  instanceId,
  status,
}: WorkflowStatusButtonsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const apply = (nextStatus: string) =>
    startTransition(async () => {
      const result = await setWorkflowInstanceStatus(
        clientId,
        instanceId,
        nextStatus,
      );
      setMessage(result.message ?? null);
      setIsError(result.status === "error");
    });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== "active" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => apply("active")}
          >
            Resume
          </Button>
        ) : null}
        {status === "active" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => apply("paused")}
          >
            Pause
          </Button>
        ) : null}
        {status !== "disabled" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/5"
            disabled={isPending}
            onClick={() => apply("disabled")}
          >
            Disable
          </Button>
        ) : null}
      </div>
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
