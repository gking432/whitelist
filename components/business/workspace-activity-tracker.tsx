"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { WorkspaceModule } from "@/lib/business/workspace-preferences-contract";

const areas: Record<string, WorkspaceModule> = {
  "/client/messages": "messages", "/client/conversations": "messages",
  "/client/calendar": "appointments", "/client/todo": "todo", "/client/money": "money",
};
/** Only a coarse, visible area open. No route, message, URL or device details leave this component. */
export function WorkspaceActivityTracker() {
  const path = usePathname();
  const area = areas[path];
  useEffect(() => {
    if (!area) return;
    let recorded = false;
    const record = () => {
      if (recorded || document.visibilityState !== "visible") return;
      recorded = true;
      void fetch("/api/business/workspace-preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activity", module: area }) }).catch(() => {});
    };
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [area]);
  return null;
}
