"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { LiveCallOverlay } from "@/components/assistant/live-call-overlay";
import { PersonalAssistantLauncher } from "@/components/personal-assistant/launcher";
import { PersonalAssistantPreferencesProvider } from "@/components/personal-assistant/preferences-provider";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import { DailyBriefShell } from "@/components/business/daily-brief-shell";
import { isOwnerArea, OWNER_AREAS } from "@/lib/business/owner-navigation";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";
import type { PortalBranding } from "@/lib/clients/portal";
import { brandStyleVariables } from "@/lib/branding";
import { clearFirstOwnerDraftAfterProvision } from "@/components/onboarding/first-owner-draft";
import type { ClientExperienceMode } from "@/lib/clients/constants";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";

type Props = {
  children: React.ReactNode;
  banner?: React.ReactNode;
  accountActions?: React.ReactNode;
  clientName: string;
  branding: PortalBranding;
  experienceMode: ClientExperienceMode;
  userEmail: string;
  visibleSections: ClientSectionKey[];
  unreadNotificationCount: number;
  canManageConnections?: boolean;
  canReviewLaunch?: boolean;
  businessWorkspace?: boolean;
  personalAssistantScopeKey?: string;
};
export function PortalShell({
  children,
  banner,
  accountActions,
  clientName,
  branding,
  experienceMode,
  userEmail,
  visibleSections,
  unreadNotificationCount,
  canManageConnections = false,
  canReviewLaunch = false,
  businessWorkspace = false,
  personalAssistantScopeKey,
}: Props) {
  const pathname = usePathname();
  const assistantViewport = useRef<HTMLDivElement>(null);
  useEffect(() => { if (assistantViewport.current) assistantViewport.current.scrollTop = 0; }, [pathname]);
  const onboarding = pathname === "/client/onboarding";
  useEffect(() => {
    if (!onboarding || !businessWorkspace || !personalAssistantScopeKey) return;
    try { clearFirstOwnerDraftAfterProvision(window.sessionStorage, personalAssistantScopeKey); } catch { /* Storage may be unavailable; server access remains authoritative. */ }
  }, [onboarding, businessWorkspace, personalAssistantScopeKey]);
  if (onboarding) {
    const content = <div data-business-onboarding-layout className="min-h-dvh bg-white text-slate-900">{children}</div>;
    return businessWorkspace && personalAssistantScopeKey
      ? <PersonalAssistantPreferencesProvider key={personalAssistantScopeKey} scopeKey={personalAssistantScopeKey}>{content}</PersonalAssistantPreferencesProvider>
      : content;
  }
  const simpleView = pathname === "/client/mobile";
  const crm = experienceMode === "northstar_crm";
  const legacyNavigation: (WorkspaceNavItem & { section: ClientSectionKey })[] =
    [
      ...(crm
        ? [
            {
              label: "Customer workspace",
              href: "/client/crm",
              section: "overview" as const,
              icon: "clients" as const,
              group: "Your business",
            },
          ]
        : []),
      {
        label: "Overview",
        href: crm ? "/client/action-center" : "/client",
        exact: true,
        section: "action-center",
        icon: "home",
        group: "Your business",
      },
      {
        label: "Approvals",
        href: "/client/approvals",
        section: "approvals",
        icon: "approvals",
        group: "Your business",
      },
      {
        label: "Assistant",
        href: "/client/assistant",
        section: "assistant",
        icon: "assistant",
        group: "Your business",
      },
      {
        label: "Activity",
        href: "/client/activity",
        section: "activity",
        icon: "activity",
        group: "Your business",
      },
      {
        label: "Notifications",
        href: "/client/notifications",
        section: "notifications",
        icon: "notifications",
        group: "Your business",
        badge: unreadNotificationCount,
      },
      ...(canManageConnections
        ? [
            {
              label: "Apps & automations",
              href: "/client/integrations",
              section: "settings" as const,
              icon: "apps" as const,
              group: "Manage",
            },
          ]
        : []),
      ...(canReviewLaunch
        ? [
            {
              label: "Launch checklist",
              href: "/client/launch",
              section: "settings" as const,
              icon: "setup" as const,
              group: "Manage",
            },
          ]
        : []),
      {
        label: "Get help",
        href: "/client/support",
        section: "support",
        icon: "help",
        group: "Manage",
      },
    ];
  const navigation: (WorkspaceNavItem & { section: ClientSectionKey })[] =
    businessWorkspace
      ? [
          ...OWNER_AREAS,
          {
            label: "Agent team",
            href: "/client/team",
            section: "automations",
            icon: "assistant",
            group: "Your business",
          },
          {
            label: "Simple view",
            href: "/client/mobile",
            section: "action-center",
            icon: "approvals",
            group: "Your business",
          },
          {
            label: "Approvals",
            href: "/client/business/approvals",
            section: "approvals",
            icon: "approvals",
            group: "Your business",
          },
          {
            label: "Customers",
            href: "/client/business/customers",
            section: "contacts",
            icon: "clients",
            group: "Your business",
          },
          {
            label: "Marketing",
            href: "/client/business/marketing",
            section: "marketing",
            icon: "marketing",
            group: "Business areas",
          },
          {
            label: "Sourcing",
            href: "/client/business/sourcing",
            section: "settings",
            icon: "sourcing",
            group: "Business areas",
          },
          {
            label: "Purchasing",
            href: "/client/business/purchasing",
            section: "settings",
            icon: "purchasing",
            group: "Business areas",
          },
          {
            label: "Operations",
            href: "/client/business/operations",
            section: "tasks",
            icon: "operations",
            group: "Business areas",
          },
          {
            label: "Capabilities",
            href: "/client/business/automations",
            section: "automations",
            icon: "assistant",
            group: "Manage",
          },
          {
            label: "Business settings",
            href: "/client/business/business",
            section: "settings",
            icon: "settings",
            group: "Manage",
          },
          {
            label: "Detailed CRM",
            href: "/client/crm",
            section: "overview",
            icon: "solutions",
            group: "More",
          },
          {
            label: "Notifications",
            href: "/client/notifications",
            section: "notifications",
            icon: "notifications",
            group: "More",
            badge: unreadNotificationCount,
          },
          {
            label: "Get help",
            href: "/client/support",
            section: "support",
            icon: "help",
            group: "More",
          },
        ]
      : legacyNavigation;
  const brand = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/8 text-sm font-semibold text-primary">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt=""
            className="size-full object-contain"
          />
        ) : (
          branding.productName.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="truncate text-sm font-semibold">
        {branding.productName}
      </span>
    </div>
  );
  const content = <>
      {businessWorkspace && isOwnerArea(pathname) ? (
        <DailyBriefShell
          brandName={
            branding.productName === "Partner Workspace CRM"
              ? "Business workspace"
              : branding.productName
          }
          clientName={clientName}
          email={userEmail}
          navigation={navigation.filter((item) =>
            visibleSections.includes(item.section),
          )}
          banner={banner}
          accountActions={accountActions}
        >
          {children}
        </DailyBriefShell>
      ) : simpleView || pathname.startsWith("/client/crm") ? (
        <>
          {banner}
          {accountActions ? <div className="flex justify-end px-5 py-2">{accountActions}</div> : null}
          {children}
        </>
      ) : (
        <WorkspaceChrome
          brand={brand}
          home="/client"
          workspaceName={clientName}
          roleLabel="Your business workspace"
          userEmail={userEmail}
          navigation={navigation.filter((item) =>
            visibleSections.includes(item.section),
          )}
          banner={banner}
          accountActions={accountActions}
          footer={
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
              <p>
                {branding.reportFooterText ??
                  `Managed by ${branding.partnerName}.`}
              </p>
              <p>
                {branding.supportLabel}
                {branding.supportEmail ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={`mailto:${branding.supportEmail}`}
                      className="underline"
                    >
                      {branding.supportEmail}
                    </a>
                  </>
                ) : null}
                {branding.supportPhone ? ` · ${branding.supportPhone}` : ""}
              </p>
            </div>
          }
        >
          {children}
        </WorkspaceChrome>
      )}
      {!simpleView && visibleSections.includes("assistant") ? (
        <LiveCallOverlay productName={branding.productName} />
      ) : null}
    </>;
  const personalAssistant = businessWorkspace && personalAssistantScopeKey;
  return <div style={brandStyleVariables(branding)} className={personalAssistant ? "flex h-dvh flex-col overflow-hidden lg:block lg:h-auto lg:overflow-visible" : undefined}>{personalAssistant ? <PersonalAssistantPreferencesProvider key={personalAssistant} scopeKey={personalAssistant}>
    <div ref={assistantViewport} className="min-h-0 flex-1 overflow-y-auto lg:contents" data-personal-assistant-viewport onClickCapture={(event) => { if (simpleView && event.target instanceof Element && event.target.closest('nav[aria-label="Simple business navigation"] button')) event.currentTarget.scrollTop = 0; }}>{content}</div>
    <PersonalAssistantLauncher mobileNavigation={simpleView} />
  </PersonalAssistantPreferencesProvider> : content}</div>;
}
