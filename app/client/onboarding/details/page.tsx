import Link from "next/link";
import { redirect } from "next/navigation";
import { BusinessContextReview } from "@/components/business/context-review";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { loadClientPortal } from "@/lib/clients/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Business details and permissions" } };
export default async function BusinessSetupDetailsPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  return <><Link href="/client/onboarding" className="mx-5 mt-5 inline-flex min-h-11 items-center text-sm text-blue-700 underline sm:mx-8">Back to setup</Link><BusinessContextReview /></>;
}
