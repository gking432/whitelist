import Link from "next/link";
import {
  Bot,
  CheckSquare,
  ContactRound,
  FlaskConical,
  PlugZap,
  Workflow,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { ensurePartnerAgencyBusiness } from "@/lib/partners/agency-business";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "My Agency" };
export const dynamic = "force-dynamic";

export default async function PartnerAgencyPage() {
  const user = await requireAuthenticatedUser("/partner/agency");
  const access = await requirePrimaryPartnerAccess(user.id);
  const admin = createSupabaseAdminClient();

  if (!admin || !access.partnerId) return null;

  const agency = await ensurePartnerAgencyBusiness(admin, {
    partnerId: access.partnerId,
    userId: user.id,
  });
  const base = `/partner/clients/${agency.id}`;
  const tools = [
    { label: "CRM", detail: "Run your agency leads, tasks, and customer history in Northstar.", href: `${base}/crm`, icon: ContactRound },
    { label: "AI Assistant", detail: "Use the same drafting, intake, and scheduling tools you sell.", href: `${base}/assistant`, icon: Bot },
    { label: "Approvals", detail: "Approve customer-facing actions for your agency business only.", href: `${base}/approvals`, icon: CheckSquare },
    { label: "AI Workflows", detail: "Enable and configure automations for your own front line.", href: `${base}/workflows`, icon: Workflow },
    { label: "Integrations", detail: "Connect your agency CRM, messaging, email, and calendar.", href: `${base}/integrations`, icon: PlugZap },
    { label: "Test Center", detail: "Verify your agency tools with the same guided tests as clients.", href: `${base}/test-center`, icon: FlaskConical },
  ];

  return (
    <AppShell
      organizationName={agency.name}
      userEmail={user.email ?? "Authenticated user"}
      activeNav="agency"
    >
      <div className="space-y-6">
        <header className="border-b pb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">My Agency</p>
          <h1 className="mt-1 text-xl font-semibold">Agency operations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Use Northstar&apos;s CRM, AI tools, and workflows inside your own business. This operational workspace is separate from managed-client support.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div key={tool.label} className="rounded-lg border bg-card p-5">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <h2 className="mt-3 font-semibold">{tool.label}</h2>
                <p className="mt-1 min-h-10 text-sm leading-5 text-muted-foreground">{tool.detail}</p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href={tool.href}>Open {tool.label}</Link>
                </Button>
              </div>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
