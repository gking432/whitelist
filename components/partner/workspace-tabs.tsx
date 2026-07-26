"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type WorkspaceTabsProps = {
  clientId: string;
  accountKind?: "managed_client" | "partner_agency";
};

const managedClientTabs = [
  { label: "Overview", segment: "", matches: [""] },
  {
    label: "Package & Setup",
    segment: "setup",
    matches: ["setup", "integrations", "automation-packs", "knowledge"],
  },
  { label: "Automations", segment: "workflows", matches: ["workflows"] },
  { label: "Test Center", segment: "test-center", matches: ["test-center"] },
  { label: "Launch", segment: "launch", matches: ["launch"] },
  {
    label: "Activity & Logs",
    segment: "runs",
    matches: ["runs", "audit", "approvals"],
  },
  { label: "Settings", segment: "settings", matches: ["settings"] },
];

const agencyTabs = [
  { label: "CRM", segment: "crm", matches: ["crm"] },
  { label: "Assistant", segment: "assistant", matches: ["assistant"] },
  { label: "Approvals", segment: "approvals", matches: ["approvals"] },
  {
    label: "Automations",
    segment: "workflows",
    matches: ["workflows", "automation-packs"],
  },
  { label: "Integrations", segment: "integrations", matches: ["integrations"] },
  { label: "Test Center", segment: "test-center", matches: ["test-center"] },
  { label: "Activity", segment: "runs", matches: ["runs", "audit"] },
];

export function WorkspaceTabs({
  clientId,
  accountKind = "managed_client",
}: WorkspaceTabsProps) {
  const pathname = usePathname();
  const base = `/partner/clients/${clientId}`;
  const tabs =
    accountKind === "partner_agency" ? agencyTabs : managedClientTabs;

  return (
    <nav
      aria-label="Client workspace sections"
      className="-mb-px flex gap-0.5 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const currentSegment =
          pathname.slice(base.length + 1).split("/")[0] ?? "";
        const isActive = tab.matches.includes(currentSegment);

        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] transition-colors",
              isActive
                ? "border-primary font-semibold text-foreground"
                : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
