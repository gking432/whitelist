import { NorthstarMark } from "@/components/brand/northstar-mark";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";

export type PartnerNavKey =
  | "start"
  | "dashboard"
  | "agency"
  | "clients"
  | "packages"
  | "integrations"
  | "support"
  | "settings"
  | "lab";
const navigation: (WorkspaceNavItem & { key: PartnerNavKey })[] = [
  {
    key: "dashboard",
    label: "Overview",
    href: "/partner",
    icon: "home",
    group: "Your agency",
  },
  {
    key: "clients",
    label: "Clients",
    href: "/partner/clients",
    icon: "clients",
    group: "Your agency",
  },
  {
    key: "agency",
    label: "Sales workspace",
    href: "/partner/agency",
    icon: "agency",
    group: "Your agency",
  },
  {
    key: "start",
    label: "Getting started",
    href: "/partner/start",
    icon: "setup",
    group: "Build your offer",
  },
  {
    key: "packages",
    label: "Solutions & packages",
    href: "/partner/packages",
    icon: "solutions",
    group: "Build your offer",
  },
  {
    key: "integrations",
    label: "Connected apps",
    href: "/partner/integrations",
    icon: "apps",
    group: "Build your offer",
  },
  {
    key: "settings",
    label: "Brand & settings",
    href: "/partner/settings",
    icon: "settings",
    group: "Manage",
  },
  {
    key: "support",
    label: "Help & requests",
    href: "/partner/support",
    icon: "help",
    group: "Manage",
  },
];
export function AppShell({
  children,
  organizationName,
  userEmail,
  activeNav = "dashboard",
}: {
  children: React.ReactNode;
  organizationName: string;
  userEmail: string;
  activeNav?: PartnerNavKey;
}) {
  return (
    <WorkspaceChrome
      brand={<NorthstarMark surface="light" />}
      home="/partner"
      workspaceName={organizationName}
      roleLabel="Partner workspace"
      userEmail={userEmail}
      navigation={navigation.map((item) => ({
        ...item,
        active: item.key === activeNav,
      }))}
      banner={<ImpersonationBanner />}
      help={{ href: "/partner/start", label: "Your launch checklist" }}
    >
      {children}
    </WorkspaceChrome>
  );
}
