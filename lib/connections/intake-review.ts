import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const ReviewQuery = z.object({ connectionId: z.uuid(), recordId: z.uuid(), q: z.string().trim().max(100).default("") }).strict();
type Scope = { partnerId: string; clientId: string };
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";

/** An explicit customer chooser: it never infers that a matching claim is an identity. */
export async function readIntakeReview(admin: SupabaseClient, scope: Scope, raw: unknown) {
  const query = ReviewQuery.parse(raw);
  const { data: source, error } = await admin.from("integration_canonical_records")
    .select("id,connection_id,external_object_id,updated_at,canonical_data,native_object_id")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId)
    .eq("connection_id", query.connectionId).eq("id", query.recordId).eq("object_type", "lead").maybeSingle();
  if (error) throw new Error("Form inquiry could not be loaded.");
  if (!source || source.native_object_id || source.canonical_data?.deleted === true || source.canonical_data?.status === "deleted")
    throw new Error("This inquiry was removed or already added to shared work. Refresh the source view.");
  const { data: connection, error: connectionError } = await admin.from("integration_connections")
    .select("display_name,status,runtime_mode,config,provider:integration_providers!inner(provider_key)")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("id", query.connectionId).maybeSingle();
  const provider = connection?.provider as unknown as { provider_key?: string } | undefined;
  if (connectionError || provider?.provider_key !== "generic_inbound_webhook" || connection?.status !== "connected"
    || connection.runtime_mode === "paused" || connection.config?.workspace_view_only !== true)
    throw new Error("Resume and verify the form source before adding this inquiry.");
  // Strip PostgREST filter syntax, wildcard characters and quotes. This search
  // only narrows the deliberate chooser; it does not select or merge a contact.
  const search = query.q.replace(/[^\p{L}\p{N}@.+ -]/gu, " ").trim();
  let contactsQuery = admin.from("crm_contacts").select("id,first_name,last_name,email,phone,updated_at")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  if (search) contactsQuery = contactsQuery.or(["first_name", "last_name", "email", "phone"].map((field) => `${field}.ilike.%${search}%`).join(","));
  const contacts = await contactsQuery.order("first_name").order("id").limit(51);
  if (contacts.error) throw new Error("Customer choices could not be loaded. Retry before choosing an identity.");
  const claims = source.canonical_data ?? {};
  return {
    source: {
      id: source.id, connectionId: source.connection_id, externalId: source.external_object_id, updatedAt: source.updated_at,
      title: text(claims.title, 200) || "Website inquiry", name: text(claims.name, 200),
      email: text(claims.email, 320), phone: text(claims.phone, 60), description: text(claims.description, 6000),
      account: connection.display_name || "Website form",
    },
    contacts: (contacts.data ?? []).slice(0, 50).map((contact) => ({
      id: contact.id, name: [text(contact.first_name, 200), text(contact.last_name, 200)].filter(Boolean).join(" ") || "Unnamed customer",
      email: text(contact.email, 320), phone: text(contact.phone, 60), updatedAt: contact.updated_at,
    })),
    limited: (contacts.data?.length ?? 0) > 50,
  };
}
