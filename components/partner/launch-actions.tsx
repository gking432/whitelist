"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Rocket, RotateCcw } from "lucide-react";

import {
  goLive,
  rollbackLaunch,
  runPackageTests,
} from "@/app/partner/clients/[clientId]/launch/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { initialFormState } from "@/lib/forms/state";
import { cn } from "@/lib/utils";

type LaunchActionsProps = {
  clientId: string;
  launchId: string | null;
  launchStatus: string | null;
  canManage: boolean;
  canRunTests: boolean;
  canGoLive: boolean;
};

export function LaunchActions({
  clientId,
  launchId,
  launchStatus,
  canManage,
  canRunTests,
  canGoLive,
}: LaunchActionsProps) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{
    status: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ status: string; message?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({
        status: result.status === "success" ? "success" : "error",
        text: result.message ?? "Action complete.",
      });
      router.refresh();
    });
  };

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Your role can view launch readiness but cannot change runtime modes.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {launchStatus === "live" && launchId ? (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() =>
                rollbackLaunch(
                  clientId,
                  launchId,
                  initialFormState,
                  new FormData(),
                ),
              )
            }
          >
            <RotateCcw aria-hidden="true" />
            {isPending ? "Restoring..." : "Roll back launch"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Restores the exact workflow, connection, and client modes from
            before launch.
          </span>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={isPending || !canRunTests}
            onClick={() =>
              run(() =>
                runPackageTests(clientId, initialFormState, new FormData()),
              )
            }
          >
            <FlaskConical aria-hidden="true" />
            {isPending
              ? "Running final safety check..."
              : "Run final safety check"}
          </Button>

          {launchId && launchStatus === "ready" ? (
            <div className="border-t pt-4">
              <label className="flex items-start gap-2.5 text-sm leading-5">
                <Checkbox
                  name="confirm_live"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={isPending || !canGoLive}
                  className="mt-0.5"
                />
                <span>
                  I confirm approved actions may use the listed real provider
                  connections.
                </span>
              </label>
              <Button
                type="button"
                className="mt-3 w-full sm:w-auto"
                disabled={isPending || !canGoLive || !confirmed}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("confirm_live", "yes");
                  run(() =>
                    goLive(clientId, launchId, initialFormState, formData),
                  );
                }}
              >
                <Rocket aria-hidden="true" />
                {isPending ? "Launching..." : "Go live"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {message ? (
        <p
          role="status"
          className={cn(
            "text-sm",
            message.status === "success"
              ? "text-emerald-700"
              : "text-destructive",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
