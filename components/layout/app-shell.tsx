import Link from "next/link";
import { LayoutDashboard, Package, UsersRound } from "lucide-react";

import { NorthstarMark } from "@/components/brand/northstar-mark";
import { cn } from "@/lib/utils";

const navigation = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/partner",
    icon: LayoutDashboard,
  },
  {
    key: "clients",
    label: "Clients",
    href: "/partner/clients",
    icon: UsersRound,
  },
  {
    key: "packages",
    label: "Packages",
    href: "/partner/packages",
    icon: Package,
  },
] as const;

export type PartnerNavKey = (typeof navigation)[number]["key"];

type AppShellProps = {
  children: React.ReactNode;
  organizationName: string;
  userEmail: string;
  activeNav?: PartnerNavKey;
};

export function AppShell({
  children,
  organizationName,
  userEmail,
  activeNav = "dashboard",
}: AppShellProps) {
  const monogram = userEmail.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="flex flex-col border-b border-white/10 bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0">
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-5 lg:justify-start">
            <Link href="/partner" className="block">
              <NorthstarMark subtitle="Partner Command Center" />
            </Link>
          </div>

          <div className="px-5 pb-1 pt-4">
            <p className="truncate text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/45">
              {organizationName}
            </p>
          </div>

          <nav className="flex gap-1 px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:py-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeNav;

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-sidebar-foreground/65 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon
                    className={cn("size-4", active && "text-brand-gold")}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <p className="hidden px-5 pb-4 text-[11px] leading-5 text-sidebar-foreground/40 lg:block">
            Integrations, workflows, runs, approvals, reports, and audit
            history live inside each client workspace.
          </p>

          <div className="hidden border-t border-white/10 p-4 lg:block">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                {monogram}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-medium text-white">
                  Signed in
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/55">
                  {userEmail}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="ns-fade-up mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 lg:px-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
