import { redirect } from "next/navigation";

// The former "Pilot Stack" screen merged into the package-driven Setup
// checklist (docs/12: pilot providers are just required integrations for
// the selected package). This route stays only so old links and OAuth
// callbacks keep working.

type PageProps = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ google?: string }>;
};

export default async function PilotRedirectPage({
  params,
  searchParams,
}: PageProps) {
  const { clientId } = await params;
  const { google } = await searchParams;

  redirect(
    `/partner/clients/${clientId}/setup${google ? `?google=${encodeURIComponent(google)}` : ""}`,
  );
}
