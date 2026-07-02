"use client";

import { useState, useTransition } from "react";

import { archiveClientBusiness } from "@/app/partner/clients/actions";
import { Button } from "@/components/ui/button";

type ArchiveClientButtonProps = {
  clientId: string;
  clientName: string;
};

export function ArchiveClientButton({
  clientId,
  clientName,
}: ArchiveClientButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/5"
        onClick={() => setConfirming(true)}
      >
        Archive client
      </Button>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm font-medium">
        Archive {clientName}? Active workflows stop appearing in operations
        views.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                await archiveClientBusiness(clientId);
              } catch {
                setError("The client could not be archived. Try again.");
              }
            })
          }
        >
          {isPending ? "Archiving…" : "Confirm archive"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
