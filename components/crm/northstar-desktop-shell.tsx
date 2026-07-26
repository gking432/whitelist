"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Cable,
  Calculator,
  CalendarDays,
  Compass,
  Inbox,
  Kanban,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plus,
  Search,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brandStyleVariables, type BrandColors } from "@/lib/branding";
import type { CrmView } from "@/lib/crm/views";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";
import { cn } from "@/lib/utils";

const CRM_NAVIGATION: Array<{
  label: string;
  view: CrmView;
  icon: typeof LayoutDashboard;
}> = [
  {
    label: "Overview",
    view: "overview",
    icon: LayoutDashboard,
  },
  {
    label: "Inbox",
    view: "inbox",
    icon: Inbox,
  },
  {
    label: "Leads",
    view: "contacts",
    icon: Users,
  },
  {
    label: "Calls",
    view: "calls",
    icon: Bot,
  },
  {
    label: "Pipeline",
    view: "pipeline",
    icon: Kanban,
  },
  {
    label: "Tasks",
    view: "tasks",
    icon: ListChecks,
  },
  {
    label: "Appointments",
    view: "schedule",
    icon: CalendarDays,
  },
  {
    label: "Quote Tool",
    view: "quotes",
    icon: Calculator,
  },
  {
    label: "Marketing",
    view: "marketing",
    icon: Activity,
  },
  {
    label: "AI Automations",
    view: "automations",
    icon: Workflow,
  },
  {
    label: "Reports",
    view: "reports",
    icon: BarChart3,
  },
  {
    label: "CRM Sync",
    view: "crm-sync",
    icon: Cable,
  },
  {
    label: "Settings",
    view: "settings",
    icon: Settings,
  },
];

const PAGE_TITLES: Record<CrmView, string> = {
  overview: "Overview",
  inbox: "Inbox",
  contacts: "Leads",
  calls: "Calls",
  pipeline: "Pipeline",
  tasks: "Tasks",
  schedule: "Appointments",
  quotes: "Quote Tool",
  marketing: "Marketing",
  automations: "AI Automations",
  reports: "Reports",
  "crm-sync": "CRM Sync",
  settings: "Settings",
};

function initials(email: string) {
  return email.trim().slice(0, 1).toUpperCase() || "U";
}

function SidebarContent({
  clientName,
  productName,
  logoUrl,
  currentView,
  userEmail,
  visibleSections,
  basePath,
  actionCenterLink,
  homeLink,
  workspaceLabel,
  onNavigate,
}: {
  clientName: string;
  productName: string;
  logoUrl: string | null;
  currentView: CrmView;
  userEmail: string;
  visibleSections: ClientSectionKey[];
  basePath: string;
  actionCenterLink: { href: string; label: string } | null;
  homeLink: { href: string; label: string } | null;
  workspaceLabel: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-foreground/10 px-5">
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-gold text-brand-deep">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <Compass className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="line-clamp-2 text-xs font-semibold leading-4 text-sidebar-foreground">
            {productName}
          </p>
          <p className="truncate text-[11px] text-sidebar-foreground/60">
            {clientName}
          </p>
        </div>
      </div>

      <nav
        aria-label="CRM sections"
        className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4"
      >
        {CRM_NAVIGATION.filter((item) =>
          visibleSections.includes(item.view),
        ).map((item) => {
          const Icon = item.icon;
          const active = item.view === currentView;

          return (
            <Link
              key={item.view}
              href={`${basePath}?view=${item.view}`}
              onClick={onNavigate}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-foreground/10 text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-foreground/10 p-4">
        {actionCenterLink ? (
          <Link
            href={actionCenterLink.href}
            onClick={onNavigate}
            className="mb-4 flex h-9 items-center gap-3 rounded-md border border-brand-gold/35 bg-brand-gold/10 px-3 text-sm font-medium text-brand-gold transition-colors hover:bg-brand-gold/20"
          >
            <Activity className="size-4" aria-hidden="true" />
            {actionCenterLink.label}
          </Link>
        ) : null}
        {homeLink ? (
          <Link
            href={homeLink.href}
            onClick={onNavigate}
            className="mb-4 flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground"
          >
            <LayoutDashboard className="size-4" aria-hidden="true" />
            {homeLink.label}
          </Link>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sm font-medium text-sidebar-foreground">
            {initials(userEmail)}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {userEmail}
            </p>
            <p className="text-[11px] text-sidebar-foreground/60">
              {workspaceLabel}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export function NorthstarDesktopShell({
  children,
  clientName,
  productName,
  logoUrl,
  currentView,
  userEmail,
  visibleSections,
  canViewActionCenter,
  canEditCrmData,
  unreadNotificationCount,
  basePath = "/client/crm",
  assistantPath,
  notificationsPath = "/client/notifications",
  actionCenterPath = "/client/action-center",
  actionCenterLabel = "Action Center",
  homeLink = null,
  workspaceLabel = "Client workspace",
  brandColors,
}: {
  children: React.ReactNode;
  clientName: string;
  productName: string;
  logoUrl: string | null;
  currentView: CrmView;
  userEmail: string;
  visibleSections: ClientSectionKey[];
  canViewActionCenter: boolean;
  canEditCrmData: boolean;
  unreadNotificationCount: number;
  basePath?: string;
  assistantPath?: string | null;
  notificationsPath?: string | null;
  actionCenterPath?: string | null;
  actionCenterLabel?: string;
  homeLink?: { href: string; label: string } | null;
  workspaceLabel?: string;
  brandColors?: BrandColors;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const resolvedAssistantPath =
    assistantPath === undefined
      ? visibleSections.includes("assistant")
        ? "/client/assistant"
        : null
      : assistantPath;
  const actionCenterLink =
    canViewActionCenter && actionCenterPath
      ? { href: actionCenterPath, label: actionCenterLabel }
      : null;

  return (
    <div
      className="flex min-h-screen bg-background"
      style={brandColors ? brandStyleVariables(brandColors) : undefined}
    >
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarContent
          clientName={clientName}
          productName={productName}
          logoUrl={logoUrl}
          currentView={currentView}
          userEmail={userEmail}
          visibleSections={visibleSections}
          basePath={basePath}
          actionCenterLink={actionCenterLink}
          homeLink={homeLink}
          workspaceLabel={workspaceLabel}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[86vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-3 z-10 text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
              onClick={() => setMobileOpen(false)}
              title="Close navigation"
            >
              <X aria-hidden="true" />
            </Button>
            <SidebarContent
              clientName={clientName}
              productName={productName}
              logoUrl={logoUrl}
              currentView={currentView}
              userEmail={userEmail}
              visibleSections={visibleSections}
              basePath={basePath}
              actionCenterLink={actionCenterLink}
              homeLink={homeLink}
              workspaceLabel={workspaceLabel}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            title="Open navigation"
          >
            <Menu aria-hidden="true" />
          </Button>
          <h1 className="min-w-0 truncate text-lg font-semibold">
            {PAGE_TITLES[currentView]}
          </h1>
          {visibleSections.includes("contacts") ? (
            <form
              action={basePath}
              className="relative ml-auto hidden w-full max-w-xs md:block"
            >
              <input type="hidden" name="view" value="contacts" />
              <Search
                className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                name="search"
                placeholder="Search leads"
                className="pl-9"
              />
            </form>
          ) : (
            <span className="ml-auto" />
          )}
          {resolvedAssistantPath ? (
            <Button asChild size="icon" variant="outline">
              <Link href={resolvedAssistantPath} aria-label="Open AI assistant">
                <Bot aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          {notificationsPath && visibleSections.includes("notifications") ? (
            <Button asChild size="icon" variant="outline" className="relative">
              <Link
                href={notificationsPath}
                aria-label={`Notifications${
                  unreadNotificationCount > 0
                    ? `, ${unreadNotificationCount} unread`
                    : ""
                }`}
              >
                <Bell aria-hidden="true" />
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
                    {Math.min(unreadNotificationCount, 99)}
                  </span>
                ) : null}
              </Link>
            </Button>
          ) : null}
          {canEditCrmData &&
          (visibleSections.includes("pipeline") ||
            visibleSections.includes("contacts")) ? (
            <Button asChild size="sm" className="ml-auto shrink-0 md:ml-0">
              <Link
                href={`${basePath}?view=pipeline&new=1#new-lead`}
                aria-label="New lead"
              >
                <Plus aria-hidden="true" />
                <span className="hidden sm:inline">New Lead</span>
              </Link>
            </Button>
          ) : null}
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
            {initials(userEmail)}
          </span>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
