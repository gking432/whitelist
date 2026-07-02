"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{clientName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Operations portal · provided by {branding.partnerName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">Client portal</Badge>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {userEmail}
            </span>
          </div>
        </div>
        <nav
          aria-label="Portal sections"
          className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-5"
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
                  "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
        {children}
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {branding.reportFooterText ??
              `Managed by ${branding.partnerName}.`}
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
