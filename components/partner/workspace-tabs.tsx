"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

type WorkspaceTabsProps = {
  clientId: string;
  accountKind?: "managed_client" | "partner_agency";
};

const managedClientTabs = [
  { label: "Overview", segment: "", matches: [""] },
  {
    label: "Setup",
    segment: "setup",
    matches: ["setup", "automation-packs"],
  },
  {
    label: "Connected apps",
    segment: "connections",
    matches: ["connections", "integrations"],
  },
  { label: "Business knowledge", segment: "knowledge", matches: ["knowledge"] },
  { label: "Automations", segment: "workflows", matches: ["workflows"] },
  { label: "Test", segment: "test-center", matches: ["test-center"] },
  { label: "Launch", segment: "launch", matches: ["launch"] },
  {
    label: "Activity",
    segment: "runs",
    matches: ["runs", "audit"],
  },
  { label: "Approvals", segment: "approvals", matches: ["approvals"] },
  { label: "Reports", segment: "reports", matches: ["reports"] },
  { label: "Assistant", segment: "assistant", matches: ["assistant"] },
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
  {
    label: "Connected apps",
    segment: "integrations",
    matches: ["integrations"],
  },
  { label: "Test", segment: "test-center", matches: ["test-center"] },
  { label: "Activity", segment: "runs", matches: ["runs", "audit"] },
];

export function WorkspaceTabs({
  clientId,
  accountKind = "managed_client",
}: WorkspaceTabsProps) {
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const base = `/partner/clients/${clientId}`;
  const tabs =
    accountKind === "partner_agency" ? agencyTabs : managedClientTabs;

  const extraTabs =
    accountKind === "managed_client"
      ? tabs.filter((tab) =>
          [
            "knowledge",
            "approvals",
            "reports",
            "assistant",
            "settings",
          ].includes(tab.segment),
        )
      : [];
  const primaryTabs = tabs.filter((tab) => !extraTabs.includes(tab));
  const currentSegment = pathname.slice(base.length + 1).split("/")[0] ?? "";
  const currentTab = tabs.find((tab) => tab.matches.includes(currentSegment));
  return (
    <>
      <label className="flex items-center gap-3 py-3 text-sm font-medium xl:hidden">
        Client section
        <select
          aria-label="Client section"
          className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm"
          value={currentTab?.segment ?? ""}
          onChange={(event) =>
            router.push(
              event.target.value ? `${base}/${event.target.value}` : base,
            )
          }
        >
          {!currentTab ? <option value="">Choose a section</option> : null}
          {tabs.map((tab) => (
            <option key={tab.segment} value={tab.segment}>
              {tab.label}
            </option>
          ))}
        </select>
      </label>
      <nav
        aria-label={
          accountKind === "partner_agency"
            ? "Agency workspace sections"
            : "Client workspace sections"
        }
        className="-mb-px hidden flex-wrap gap-x-1 xl:flex"
      >
        {primaryTabs.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const currentSegment =
            pathname.slice(base.length + 1).split("/")[0] ?? "";
          const isActive = tab.matches.includes(currentSegment);

          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-2.5 py-3 text-[13px] transition-colors",
                isActive
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
        {extraTabs.length ? (
          <details ref={moreMenu} className="relative ml-auto">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium [&::-webkit-details-marker]:hidden",
                currentTab && extraTabs.includes(currentTab)
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {currentTab && extraTabs.includes(currentTab)
                ? currentTab.label
                : "More"}
              <ChevronDown className="size-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 min-w-52 rounded-xl border bg-card p-2 shadow-lg">
              {extraTabs.map((tab) => (
                <Link
                  key={tab.segment}
                  href={`${base}/${tab.segment}`}
                  onClick={() => {
                    if (moreMenu.current) moreMenu.current.open = false;
                  }}
                  aria-current={tab === currentTab ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-3 text-sm hover:bg-secondary",
                    tab === currentTab &&
                      "bg-primary/5 font-medium text-primary",
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          </details>
        ) : null}
      </nav>
    </>
  );
}
