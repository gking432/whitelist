"use client";

import { useActionState, useState, useTransition } from "react";

import {
  rotateConnectionSecret,
  setConnectionPaused,
  updateConnectionRuntimeMode,
  type ConnectionFormState,
} from "@/app/partner/clients/[clientId]/integrations/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RUNTIME_MODES } from "@/lib/clients/constants";
import { formatEnum } from "@/lib/format";
import { initialFormState } from "@/lib/forms/state";

type ConnectionControlsProps = {
  clientId: string;
  connectionId: string;
  status: string;
  runtimeMode: string;
  hasCredential: boolean;
};

export function ConnectionControls({
  clientId,
  connectionId,
  status,
  runtimeMode,
  hasCredential,
}: ConnectionControlsProps) {
  const boundModeAction = updateConnectionRuntimeMode.bind(
    null,
    clientId,
    connectionId,
  );
  const [modeState, modeAction, modePending] = useActionState(
    boundModeAction,
    initialFormState,
  );

  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [rotateState, setRotateState] = useState<ConnectionFormState | null>(
    null,
  );
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isPaused = status === "paused";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Connection state</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await setConnectionPaused(
                  clientId,
                  connectionId,
                  !isPaused,
                );
                setPauseMessage(result.message ?? null);
              })
            }
          >
            {isPaused ? "Resume connection" : "Pause connection"}
          </Button>
        </div>
        {pauseMessage ? (
          <p className="mt-2 text-xs text-muted-foreground">{pauseMessage}</p>
        ) : null}
      </div>

      <form action={modeAction} className="space-y-2">
        <Label htmlFor="runtime_mode">Runtime mode</Label>
        <div className="flex items-center gap-2">
          <Select
            id="runtime_mode"
            name="runtime_mode"
            defaultValue={runtimeMode}
            className="max-w-44"
          >
            {RUNTIME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatEnum(mode)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline" size="sm" disabled={modePending}>
            {modePending ? "Saving…" : "Update"}
          </Button>
        </div>
        {modeState.message ? (
          <p
            className={
              modeState.status === "error"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {modeState.message}
          </p>
        ) : null}
      </form>

      {hasCredential ? (
        <div>
          <h3 className="text-sm font-semibold">Credential</h3>
          {rotateState?.oneTimeToken ? (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                New credential — shown only once
              </p>
              <code className="mt-2 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs">
                {rotateState.oneTimeToken}
              </code>
              <p className="mt-2 text-xs leading-5 text-amber-900/80">
                Update the external system now. The previous credential is no
                longer accepted.
              </p>
            </div>
          ) : confirmingRotate ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm">
                Rotate this credential? The current value stops working
                immediately.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await rotateConnectionSecret(
                        clientId,
                        connectionId,
                      );
                      setRotateState(result);
                      setConfirmingRotate(false);
                    })
                  }
                >
                  {isPending ? "Rotating…" : "Confirm rotate"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingRotate(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setConfirmingRotate(true)}
            >
              Rotate credential
            </Button>
          )}
          {rotateState?.status === "error" ? (
            <p className="mt-2 text-xs text-destructive">
              {rotateState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
