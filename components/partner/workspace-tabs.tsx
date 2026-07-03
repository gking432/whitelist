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
      className="flex gap-1 overflow-x-auto border-b pb-px"
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
              "whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
