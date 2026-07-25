"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type WorkspaceTabsProps = {
  clientId: string;
  accountKind?: "managed_client" | "partner_agency";
};

const managedClientTabs = [
  { label: "Overview", segment: "" },
  { label: "Onboarding", segment: "setup" },
  { label: "Test Center", segment: "test-center" },
  { label: "Features", segment: "workflows" },
  { label: "Automation Packs", segment: "automation-packs" },
  { label: "Integrations", segment: "integrations" },
  { label: "Health & Logs", segment: "runs" },
  { label: "Launch", segment: "launch" },
];

const agencyTabs = [
  { label: "Agency Home", segment: "" },
  { label: "Assistant", segment: "assistant" },
  { label: "CRM", segment: "crm" },
  { label: "Approvals", segment: "approvals" },
  { label: "Workflows", segment: "workflows" },
  { label: "Automation Packs", segment: "automation-packs" },
  { label: "Integrations", segment: "integrations" },
  { label: "Test Center", segment: "test-center" },
  { label: "Activity", segment: "runs" },
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
        const isActive = tab.segment
          ? pathname.startsWith(href)
          : pathname === base;

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
