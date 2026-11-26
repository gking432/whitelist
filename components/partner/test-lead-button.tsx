"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";

import { runTestLead } from "@/app/partner/clients/[clientId]/setup/actions";
import { Button } from "@/components/ui/button";

// Fires a sample lead through the real pipeline and, on success, jumps to
// the run so the partner can watch AI analysis → draft → approval happen.
export function TestLeadButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="gold"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await runTestLead(clientId);
            setIsError(result.status === "error");
            setMessage(result.message);

            if (result.status === "success" && result.runId) {
              router.push(`/partner/clients/${clientId}/runs/${result.runId}`);
              router.refresh();
            }
          })
        }
      >
        <Rocket aria-hidden="true" />
        {isPending ? "Sending sample lead…" : "Send a test lead"}
      </Button>
      {message ? (
        <p
          className={
            isError
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
