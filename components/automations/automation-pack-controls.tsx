"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Play, RefreshCw } from "lucide-react";

import {
  installAutomationPack,
  installLaunchAutomationStack,
  verifyAutomationPack,
} from "@/app/partner/clients/[clientId]/automation-packs/actions";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/forms/state";
import type { AutomationInstallStatus } from "@/lib/automation-packs/install";

const initialState: FormState = { status: "idle" };

export function AutomationStackControls({
  clientId,
  installedCount,
  totalCount,
  canManage,
}: {
  clientId: string;
  installedCount: number;
  totalCount: number;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    installLaunchAutomationStack.bind(null, clientId),
    initialState,
  );

  if (!canManage) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <form action={action}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : installedCount > 0 ? (
            <RefreshCw aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {installedCount === totalCount
            ? "Recheck launch stack"
            : "Install launch stack"}
        </Button>
      </form>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "max-w-sm text-xs leading-5 text-destructive"
              : "max-w-sm text-xs leading-5 text-emerald-700"
          }
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function AutomationPackControls({
  clientId,
  packKey,
  status,
  canManage,
}: {
  clientId: string;
  packKey: string;
  status: AutomationInstallStatus | null;
  canManage: boolean;
}) {
  const [installState, installAction, installPending] = useActionState(
    installAutomationPack.bind(null, clientId, packKey),
    initialState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyAutomationPack.bind(null, clientId, packKey),
    initialState,
  );
  const message = verifyState.message ?? installState.message;
  const messageStatus =
    verifyState.status !== "idle" ? verifyState.status : installState.status;

  if (!canManage) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "active" ? (
          <Button type="button" size="sm" variant="outline" disabled>
            <CheckCircle2 aria-hidden="true" />
            Verified active
          </Button>
        ) : (
          <form action={installAction}>
            <Button type="submit" size="sm" disabled={installPending}>
              {installPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : status ? (
                <RefreshCw aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {status ? "Recheck setup" : "Install pack"}
            </Button>
          </form>
        )}

        {status === "ready_to_test" ? (
          <form action={verifyAction}>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={verifyPending}
            >
              {verifyPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              Verify real test
            </Button>
          </form>
        ) : null}
      </div>

      {message ? (
        <p
          role={messageStatus === "error" ? "alert" : "status"}
          className={
            messageStatus === "error"
              ? "text-xs leading-5 text-destructive"
              : "text-xs leading-5 text-emerald-700"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
