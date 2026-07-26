import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { ensurePartnerAgencyBusiness } from "@/lib/partners/agency-business";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Sales CRM" };
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
  redirect(`/partner/clients/${agency.id}/crm`);
}
