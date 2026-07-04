"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PortalBranding } from "@/lib/clients/portal";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/client" },
  { label: "Approvals", href: "/client/approvals" },
  { label: "Activity", href: "/client/activity" },
  { label: "Integrations", href: "/client/integrations" },
];

type PortalShellProps = {
  children: React.ReactNode;
  clientName: string;
  branding: PortalBranding;
  userEmail: string;
};

// Partner-branded shell: the partner is the provider, so their name carries
// the chrome. No platform branding appears here.
export function PortalShell({
  children,
  clientName,
  branding,
  userEmail,
}: PortalShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
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
          className="mx-auto -mb-px flex w-full max-w-5xl gap-0.5 overflow-x-auto px-5 pt-4"
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
                  "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
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

      <main className="ns-fade-up mx-auto w-full max-w-5xl flex-1 px-5 py-7">
        {children}
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
