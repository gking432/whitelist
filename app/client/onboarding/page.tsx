import { redirect } from "next/navigation";
import Link from "next/link";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "@/lib/business/access";
import { ownerButton } from "@/components/business/owner-ui";
import { BusinessContextReview } from "@/components/business/context-review";
import { PersonalAssistantOnboardingQuestion } from "@/components/personal-assistant/onboarding-question";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Review your business" } };

export default async function BusinessOnboardingPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const canConnect = canWriteBusinessWorkspace(portal.access) && !portal.access.isImpersonating;
  return <div className="space-y-6"><section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="connect-apps-title"><div><h2 id="connect-apps-title" className="text-base font-semibold text-slate-900">Bring your apps into the workspace</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Import records from supported apps. Customer actions still need your approval.</p></div><Link href="/client/apps" className={ownerButton}>{canConnect ? "Connect apps" : "Review connected apps"}</Link></section><PersonalAssistantOnboardingQuestion /><BusinessContextReview /></div>;
}
