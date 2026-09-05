"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import {
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CheckCheck,
  CircleHelp,
  House,
  Layers3,
  Menu,
  PlugZap,
  Rocket,
  Settings,
  ShieldCheck,
  UsersRound,
  Activity,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

const icons = {
  home: House,
  clients: UsersRound,
  agency: BriefcaseBusiness,
  solutions: Layers3,
  apps: PlugZap,
  setup: Rocket,
  settings: Settings,
  help: CircleHelp,
  checks: ShieldCheck,
  activity: Activity,
  approvals: CheckCheck,
  notifications: Bell,
  assistant: Bot,
};
export type WorkspaceNavItem = {
  label: string;
  href: string;
  group: string;
  icon: keyof typeof icons;
  active?: boolean;
  exact?: boolean;
  badge?: number;
};

export function WorkspaceNavigation({
  items,
  mobile = false,
}: {
  items: WorkspaceNavItem[];
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const isActive = (item: WorkspaceNavItem) =>
    item.active ??
    (item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`));
  const current = items.find(isActive);
  const content = (
    <nav aria-label="Workspace navigation" className="space-y-6 p-4">
      {[...new Set(items.map((item) => item.group))].map((group) => (
        <div key={group}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group}
          </p>
          <div className="space-y-1">
            {items
              .filter((item) => item.group === group)
              .map((item) => {
                const Icon = icons[item.icon];
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      if (menu.current) menu.current.open = false;
                    }}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/8 text-primary"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
  if (!mobile) return content;
  return (
    <details ref={menu} className="group border-t bg-card lg:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <Menu className="size-4" aria-hidden="true" />
        <span className="flex-1">{current?.label ?? "Workspace"}</span>
        <span className="text-xs text-muted-foreground group-open:hidden">
          Menu
        </span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">
          Close
        </span>
      </summary>
      <div className="max-h-[65vh] overflow-y-auto border-t">{content}</div>
    </details>
  );
}

export function WorkspaceHelpLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-xl border bg-background p-3 text-sm font-medium hover:bg-secondary"
    >
      {label}
      <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}
