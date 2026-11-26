import { NorthstarMark } from "@/components/brand/northstar-mark";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedUser("/control");
  const access = await requirePlatformRole(user.id);
  return (
    <WorkspaceChrome
      brand={<NorthstarMark surface="light" />}
      home="/control"
      workspaceSwitcher
      workspaceName="Platform management"
      roleLabel={access.role.replaceAll("_", " ")}
      userEmail={user.email ?? "Signed in"}
      navigation={[
        {
          label: "Overview",
          href: "/control",
          exact: true,
          group: "Daily work",
          icon: "home",
        },
        {
          label: "Partner support",
          href: "/control/support",
          group: "Daily work",
          icon: "help",
        },
        {
          label: "App requests",
          href: "/control/integrations",
          group: "Daily work",
          icon: "apps",
        },
        {
          label: "Issues to resolve",
          href: "/control/errors",
          group: "Daily work",
          icon: "activity",
        },
        {
          label: "Launch readiness",
          href: "/control/activation",
          group: "Platform setup",
          icon: "setup",
        },
        {
          label: "Connection testing",
          href: "/control/provider-pilots",
          group: "Platform setup",
          icon: "checks",
        },
        {
          label: "Beta checklist",
          href: "/control/pilot",
          group: "Platform setup",
          icon: "solutions",
        },
      ]}
    >
      {children}
    </WorkspaceChrome>
  );
}
