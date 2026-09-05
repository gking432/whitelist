import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Deliberately public branding DTO: never return the partner or secret rows. */
export async function publicAgencyBrand(slug: string | undefined) {
  if (!slug || !/^[a-z0-9-]{2,100}$/.test(slug)) return null;
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data: partner } = await admin
    .from("partners")
    .select("id,name")
    .eq("slug", slug)
    .in("status", ["active", "trial"])
    .maybeSingle();
  if (!partner) return null;
  const { data } = await admin
    .from("partner_branding")
    .select("product_name,logo_url")
    .eq("partner_id", partner.id)
    .maybeSingle();
  return {
    name: data?.product_name || partner.name,
    logoUrl:
      typeof data?.logo_url === "string" && data.logo_url.startsWith("https://")
        ? data.logo_url
        : null,
  };
}
