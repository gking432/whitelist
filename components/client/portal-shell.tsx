"use client";

import { usePathname } from "next/navigation";
import { LiveCallOverlay } from "@/components/assistant/live-call-overlay";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";
import type { PortalBranding } from "@/lib/clients/portal";
import { brandStyleVariables } from "@/lib/branding";
import type { ClientExperienceMode } from "@/lib/clients/constants";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";

type Props = {
  children: React.ReactNode;
  banner?: React.ReactNode;
  clientName: string;
  branding: PortalBranding;
  experienceMode: ClientExperienceMode;
  userEmail: string;
  visibleSections: ClientSectionKey[];
  unreadNotificationCount: number;
  canManageConnections?: boolean;
  canReviewLaunch?: boolean;
};
export function PortalShell({
  children,
  banner,
  clientName,
  branding,
  experienceMode,
  userEmail,
  visibleSections,
  unreadNotificationCount,
  canManageConnections = false,
  canReviewLaunch = false,
}: Props) {
  const pathname = usePathname();
  const crm = experienceMode === "northstar_crm";
  const navigation: (WorkspaceNavItem & { section: ClientSectionKey })[] = [
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
      {pathname.startsWith("/client/crm") ? (
        <>
          {banner}
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
      {visibleSections.includes("assistant") ? (
        <LiveCallOverlay productName={branding.productName} />
      ) : null}
    </div>
  );
}
