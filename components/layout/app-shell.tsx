import Link from "next/link";
import { LayoutDashboard, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="border-b bg-card px-4 py-4 lg:w-64 lg:border-b-0 lg:border-r lg:px-5">
          <div className="flex items-center justify-between gap-3 lg:block">
            <Link href="/partner" className="block">
              <p className="text-sm font-semibold text-foreground">
                {organizationName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Partner operations
              </p>
            </Link>
            <Badge variant="outline">Partner workspace</Badge>
          </div>

          <nav className="mt-5 flex gap-1 lg:grid">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                    item.key === activeNav
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <p className="mt-5 hidden text-xs leading-5 text-muted-foreground lg:block">
            Integrations, workflows, runs, approvals, reports, and audit history
            live inside each client workspace.
          </p>

          <div className="mt-6 hidden rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground lg:block">
            <p className="font-medium text-foreground">Signed-in account</p>
            <p className="mt-1 break-all">{userEmail}</p>
          </div>
        </aside>

        <main className="flex-1 px-5 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
