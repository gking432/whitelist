"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PortalBranding } from "@/lib/clients/portal";
import type { ClientExperienceMode } from "@/lib/clients/constants";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";
import { cn } from "@/lib/utils";

const backgroundNavigation = [
  { label: "Action Center", href: "/client", section: "action-center" },
  { label: "Assistant", href: "/client/assistant", section: "assistant" },
  { label: "Approvals", href: "/client/approvals", section: "approvals" },
  { label: "Activity", href: "/client/activity", section: "activity" },
];

const crmNavigation = [
  { label: "CRM", href: "/client/crm", section: "overview" },
  {
    label: "Action Center",
    href: "/client/action-center",
    section: "action-center",
  },
  { label: "Assistant", href: "/client/assistant", section: "assistant" },
  { label: "Approvals", href: "/client/approvals", section: "approvals" },
  { label: "Activity", href: "/client/activity", section: "activity" },
];

type PortalShellProps = {
  children: React.ReactNode;
  banner?: React.ReactNode;
  clientName: string;
  branding: PortalBranding;
  experienceMode: ClientExperienceMode;
  userEmail: string;
  visibleSections: ClientSectionKey[];
};

// Partner-branded shell: the partner is the provider, so their name carries
// the chrome. No platform branding appears here.
export function PortalShell({
  children,
  banner,
  clientName,
  branding,
  experienceMode,
  userEmail,
  visibleSections,
}: PortalShellProps) {
  const pathname = usePathname();
  const navigation = (
    experienceMode === "northstar_crm"
      ? crmNavigation
      : backgroundNavigation
  ).filter((item) =>
    visibleSections.includes(item.section as ClientSectionKey),
  );

  if (pathname.startsWith("/client/crm")) {
    return (
      <div className="min-h-screen bg-background">
        {banner}
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {banner}
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
              {clientName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight">
                {clientName}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Operations portal · provided by {branding.partnerName}
              </p>
            </div>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:block">
            {userEmail}
          </span>
        </div>
        <nav
          aria-label="Portal sections"
          className="mx-auto -mb-px flex w-full max-w-5xl gap-0.5 overflow-x-auto px-4 pt-3 sm:px-6"
        >
          {navigation.map((item) => {
            const isActive =
              item.href === "/client"
                ? pathname === "/client"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] transition-colors",
                  isActive
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="ns-fade-up mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {branding.reportFooterText ?? `Managed by ${branding.partnerName}.`}
          </p>
          <p>
            {branding.supportLabel}
            {branding.supportEmail ? ` · ${branding.supportEmail}` : ""}
            {branding.supportPhone ? ` · ${branding.supportPhone}` : ""}
          </p>
        </div>
      </footer>
    </div>
  );
}
