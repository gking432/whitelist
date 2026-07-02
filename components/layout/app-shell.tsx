import Link from "next/link";
import {
  Activity,
  BarChart3,
  BellCheck,
  ClipboardList,
  LayoutDashboard,
  Settings,
  UsersRound,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navigation = [
  {
    label: "Dashboard",
    href: "/partner",
    icon: LayoutDashboard,
    active: true,
  },
  {
    label: "Clients",
    icon: UsersRound,
  },
  {
    label: "Integrations",
    icon: Activity,
  },
  {
    label: "Workflows",
    icon: Workflow,
  },
  {
    label: "Approvals",
    icon: BellCheck,
  },
  {
    label: "Runs / Logs",
    icon: ClipboardList,
  },
  {
    label: "Reports",
    icon: BarChart3,
  },
  {
    label: "Settings",
    icon: Settings,
  },
];

type AppShellProps = {
  children: React.ReactNode;
  organizationName: string;
  userEmail: string;
};

export function AppShell({
  children,
  organizationName,
  userEmail,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="border-b bg-card px-4 py-4 lg:w-72 lg:border-b-0 lg:border-r lg:px-5">
          <div className="flex items-center justify-between gap-3 lg:block">
            <Link href="/" className="block">
              <p className="text-sm font-semibold text-foreground">
                {organizationName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Partner operations
              </p>
            </Link>
            <Badge variant="outline">Partner workspace</Badge>
          </div>

          <nav className="mt-5 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const content = (
                <>
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </>
              );
              const className = cn(
                "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                item.active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              );

              if (item.href) {
                return (
                  <Link key={item.label} href={item.href} className={className}>
                    {content}
                  </Link>
                );
              }

              return (
                <span
                  key={item.label}
                  aria-disabled="true"
                  className={cn(className, "cursor-not-allowed opacity-60")}
                >
                  {content}
                </span>
              );
            })}
          </nav>

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
