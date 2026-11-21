import { Eye, FlaskConical, LogOut } from "lucide-react";

import { stopImpersonation } from "@/app/impersonation/actions";
import { Button } from "@/components/ui/button";
import { getAuthState } from "@/lib/auth/session";
import { getActiveImpersonation } from "@/lib/impersonation/session";

export async function ImpersonationBanner() {
  const authState = await getAuthState();
  if (!authState.user) return null;

  const session = await getActiveImpersonation(authState.user.id);
  if (!session) return null;

  const targetName = session.targetClientName ?? session.targetPartnerName;
  const betaWalkthrough = session.mode === "sandbox_full" && session.returnPath === "/";
  const IsModeIcon = session.mode === "sandbox_full" ? FlaskConical : Eye;

  return (
    <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-50 text-amber-950">
      <div className="mx-auto flex min-h-11 max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <IsModeIcon className="size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold sm:text-sm">
              {betaWalkthrough ? "Testing" : "Viewing as"} {targetName}
            </p>
            <p className="text-[10px] leading-4 opacity-75 sm:text-xs">
              {session.mode === "read_only"
                ? "Read-only support session"
                : "Test account · your changes are saved"}
            </p>
          </div>
        </div>
        <form action={stopImpersonation}>
          <Button type="submit" variant="outline" size="sm" className="h-7 bg-white/70">
            <LogOut aria-hidden="true" />
            {betaWalkthrough ? "Choose workspace" : "Exit"}
          </Button>
        </form>
      </div>
    </div>
  );
}
