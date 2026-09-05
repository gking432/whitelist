import { ConfirmSession } from "@/components/auth/confirm-session";
import { toSafeNextPath } from "@/lib/auth/redirects";

export const metadata = { title: "Secure Sign In" };

export default async function ConfirmAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <ConfirmSession nextPath={toSafeNextPath(params.next)} />;
}
