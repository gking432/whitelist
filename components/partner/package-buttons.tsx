"use client";

import { useState, useTransition } from "react";

import {
  archivePackage,
  createStarterPackages,
} from "@/app/partner/packages/actions";
import { Button } from "@/components/ui/button";

export function StarterPackagesButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await createStarterPackages();
            setMessage(result.message ?? null);
          })
        }
      >
        {isPending
          ? "Creating…"
          : "Create the three starter packages"}
      </Button>
      {message ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}

export function ArchivePackageButton({ packageId }: { packageId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await archivePackage(packageId);
              setMessage(result.message ?? null);
              setConfirming(false);
            })
          }
        >
          {isPending ? "Archiving…" : "Confirm archive"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        Archive
      </Button>
      {message ? (
        <span className="text-xs text-destructive">{message}</span>
      ) : null}
    </span>
  );
}
