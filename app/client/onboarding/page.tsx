import { redirect } from "next/navigation";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { BusinessContextReview } from "@/components/business/context-review";
import { PersonalAssistantOnboardingQuestion } from "@/components/personal-assistant/onboarding-question";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Review your business" } };

export default async function BusinessOnboardingPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  return <div className="space-y-6"><PersonalAssistantOnboardingQuestion /><BusinessContextReview /></div>;
}
