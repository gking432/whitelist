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

// Desktop-first operator shell. A fixed light rail (full page height — the
// outer column carries the background so it never stops short of the
// content) and one shared content column. Green appears only on active
// states, icons, and primary actions.
export function AppShell({
  children,
  organizationName,
  userEmail,
  activeNav = "dashboard",
}: AppShellProps) {
  const monogram = userEmail.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <div className="w-56 shrink-0 border-r bg-card">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="flex h-14 shrink-0 items-center border-b px-4">
              <Link href="/partner" className="block">
                <NorthstarMark surface="light" />
              </Link>
            </div>

            <div className="px-4 pb-1 pt-4">
              <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {organizationName}
              </p>
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-1.5">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = item.key === activeNav;

                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={cn(
                      "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                      active
                        ? "bg-primary/8 font-medium text-primary"
                        : "font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        active ? "text-primary" : "text-muted-foreground/80",
                      )}
                      aria-hidden="true"
                      strokeWidth={active ? 2.25 : 2}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <p className="px-4 pb-4 text-[11px] leading-4 text-muted-foreground/80">
              Integrations, workflows, runs, approvals, and audit live inside
              each client workspace.
            </p>

            <div className="shrink-0 border-t px-3 py-3">
              <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
                  {monogram}
                </span>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-[13px] font-medium">Signed in</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {userEmail}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <main className="min-w-0 flex-1">
          <div className="ns-fade-up mx-auto w-full max-w-6xl px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
