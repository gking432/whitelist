"use client";

import { usePathname } from "next/navigation";
import { LiveCallOverlay } from "@/components/assistant/live-call-overlay";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import { DailyBriefShell } from "@/components/business/daily-brief-shell";
import { isOwnerArea, OWNER_AREAS } from "@/lib/business/owner-navigation";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";
import type { PortalBranding } from "@/lib/clients/portal";
import { brandStyleVariables } from "@/lib/branding";
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
}: Props) {
  const pathname = usePathname();
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
            label: "Apps & connections",
            href: "/client/apps",
            section: "settings",
            icon: "apps",
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
  return (
    <div style={brandStyleVariables(branding)}>
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
    </div>
  );
}
