import type { SupabaseClient } from "@supabase/supabase-js";

export type PartnerAgencyBusiness = {
  id: string;
  name: string;
  slug: string;
};

export async function ensurePartnerAgencyBusiness(
  admin: SupabaseClient,
  input: { partnerId: string; userId: string },
): Promise<PartnerAgencyBusiness> {
  const { data: existing } = await admin
    .from("client_businesses")
    .select("id, name, slug")
    .eq("partner_id", input.partnerId)
    .eq("account_kind", "partner_agency")
    .maybeSingle();

  if (existing) return existing as PartnerAgencyBusiness;

  const { data: partner, error: partnerError } = await admin
    .from("partners")
    .select("name, slug, is_test_account")
    .eq("id", input.partnerId)
    .maybeSingle();

  if (partnerError || !partner) {
    throw new Error("The partner agency profile could not be loaded.");
  }

  const { data: created, error } = await admin
    .from("client_businesses")
    .insert({
      partner_id: input.partnerId,
      name: partner.name,
      slug: `${partner.slug}-agency`,
      status: "active",
      industry: "Agency operations",
      crm_operating_mode: "primary_crm",
      default_runtime_mode: "sandbox",
      timezone: "America/Chicago",
      client_portal_enabled: false,
      partner_can_edit_client_data: true,
      account_kind: "partner_agency",
      is_test_account: partner.is_test_account,
      primary_contact_name: "Agency team",
    })
    .select("id, name, slug")
    .single();

  if (error || !created) {
    // Onboarding actions and the redirected page can reach this helper at the
    // same time. Let the unique tenant constraint choose the winner, then
    // return that workspace instead of failing the second request.
    const { data: raced } = await admin
      .from("client_businesses")
      .select("id, name, slug")
      .eq("partner_id", input.partnerId)
      .eq("account_kind", "partner_agency")
      .maybeSingle();

    if (raced) return raced as PartnerAgencyBusiness;

    throw new Error("The partner agency workspace could not be created.");
  }

  return created as PartnerAgencyBusiness;
}
