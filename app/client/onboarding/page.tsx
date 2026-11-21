import { redirect } from "next/navigation";
import Link from "next/link";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "@/lib/business/access";
import { BusinessOnboardingWizard } from "@/components/onboarding/business-onboarding-wizard";
import { QuestionScreen } from "@/components/onboarding/question-screen";
import { connectionOutcomeNotice } from "@/lib/connections/onboarding-return";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Set up your workspace" } };

export default async function BusinessOnboardingPage({ searchParams }: { searchParams: Promise<{ connection?: string | string[] }> }) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  if (portal.access.role !== "client_owner" || !canWriteBusinessWorkspace(portal.access) || portal.access.isImpersonating)
    return <QuestionScreen question="Your business owner can finish setup." step={1} total={1} nextDisabled><Link href="/client" className="text-sm text-blue-700 underline">Back to workspace</Link></QuestionScreen>;
  const connectionNotice = connectionOutcomeNotice((await searchParams).connection);
  return <BusinessOnboardingWizard scopeKey={`${portal.user.id}:${portal.client.id}`} businessName={portal.client.name} connectionNotice={connectionNotice} />;
}
