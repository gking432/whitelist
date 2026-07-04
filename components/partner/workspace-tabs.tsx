"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type WorkspaceTabsProps = {
  clientId: string;
};

const tabs = [
  { label: "Overview", segment: "" },
  { label: "Integrations", segment: "integrations" },
  { label: "Workflows", segment: "workflows" },
  { label: "Runs / Logs", segment: "runs" },
  { label: "Approvals", segment: "approvals" },
  { label: "Reports", segment: "reports" },
  { label: "Settings", segment: "settings" },
  { label: "Audit", segment: "audit" },
];

export function WorkspaceTabs({ clientId }: WorkspaceTabsProps) {
  const pathname = usePathname();
  const base = `/partner/clients/${clientId}`;

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
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
              isActive
                ? "border-brand-gold font-semibold text-foreground"
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
