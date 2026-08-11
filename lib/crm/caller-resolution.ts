import type { SupabaseClient } from "@supabase/supabase-js";

import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  findGoHighLevelContact,
  type GoHighLevelCredentials,
} from "@/lib/integrations/providers/gohighlevel";
import {
  findHubSpotContact,
  type HubSpotCredentials,
} from "@/lib/integrations/providers/hubspot";
import { normalizePhone } from "@/lib/phone/normalize";

export type CallerResolution = {
  contactId: string | null;
  status: "matched" | "created" | "unavailable";
  provider: "northstar" | "hubspot" | "gohighlevel" | null;
  externalContactId: string | null;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
};

type LocalContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

function contactPayload(contact: LocalContact) {
  return {
    name:
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
  };
}

async function findLocalContact(
  admin: SupabaseClient,
  clientId: string,
  phone: string,
): Promise<LocalContact | null> {
  const normalized = normalizePhone(phone);

  if (!normalized) return null;

  const { data } = await admin
    .from("crm_contacts")
    .select("id, first_name, last_name, phone, email, address")
    .eq("client_id", clientId)
    .not("phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);

  return (
    ((data ?? []) as LocalContact[]).find(
      (contact) => normalizePhone(contact.phone) === normalized,
    ) ?? null
  );
}

async function findExternalContact(
  admin: SupabaseClient,
  input: { partnerId: string; clientId: string; phone: string },
) {
  const { data } = await admin
    .from("integration_connections")
    .select(
      "id, provider:integration_providers!inner(provider_key, category)",
    )
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("status", "connected")
    .eq("runtime_mode", "live")
    .eq("provider.category", "crm")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const connection = data as unknown as {
    id: string;
    provider: { provider_key: string; category: string } | null;
  } | null;

  if (!connection?.provider) return null;

  if (connection.provider.provider_key === "hubspot") {
    const credentials = await readProviderCredentials<HubSpotCredentials>(
      admin,
      connection.id,
    );
    const match = credentials
      ? await findHubSpotContact(credentials.privateAppToken, {
          phone: input.phone,
          email: null,
          firstname: null,
          lastname: null,
          address: null,
        })
      : null;

    return match
      ? {
          connectionId: connection.id,
          provider: "hubspot" as const,
          match,
        }
      : null;
  }

  if (connection.provider.provider_key === "gohighlevel") {
    const credentials =
      await readProviderCredentials<GoHighLevelCredentials>(
        admin,
        connection.id,
      );
    const match = credentials
      ? await findGoHighLevelContact(credentials, { phone: input.phone })
      : null;

    return match
      ? {
          connectionId: connection.id,
          provider: "gohighlevel" as const,
          match,
        }
      : null;
  }

  return null;
}

export async function resolveCallerContact(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    phone: string | null | undefined;
  },
): Promise<CallerResolution> {
  const phone = input.phone?.trim() ?? "";

  if (!normalizePhone(phone)) {
    return {
      contactId: null,
      status: "unavailable",
      provider: null,
      externalContactId: null,
      contact: null,
    };
  }

  const local = await findLocalContact(admin, input.clientId, phone);

  if (local) {
    return {
      contactId: local.id,
      status: "matched",
      provider: "northstar",
      externalContactId: null,
      contact: contactPayload(local),
    };
  }

  let external: Awaited<ReturnType<typeof findExternalContact>> = null;

  try {
    external = await Promise.race([
      findExternalContact(admin, { ...input, phone }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
  } catch {
    external = null;
  }

  const firstName = external?.match.firstname ?? null;
  const lastName = external?.match.lastname ?? null;
  const { data: created } = await admin
    .from("crm_contacts")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      first_name: firstName,
      last_name: lastName,
      phone: external?.match.phone ?? phone,
      email: external?.match.email ?? null,
      address: external?.match.address ?? null,
      source: external?.provider ?? "phone_call",
      tags: external
        ? ["external-crm", external.provider]
        : ["phone-intake", "provisional"],
    })
    .select("id, first_name, last_name, phone, email, address")
    .single();

  if (!created) {
    return {
      contactId: null,
      status: "unavailable",
      provider: external?.provider ?? null,
      externalContactId: external?.match.id ?? null,
      contact: null,
    };
  }

  if (external) {
    await admin.from("crm_contact_links").upsert(
      {
        partner_id: input.partnerId,
        client_id: input.clientId,
        contact_id: created.id,
        connection_id: external.connectionId,
        provider_key: external.provider,
        external_contact_id: external.match.id,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "connection_id,external_contact_id" },
    );
  }

  return {
    contactId: created.id,
    status: external ? "matched" : "created",
    provider: external?.provider ?? "northstar",
    externalContactId: external?.match.id ?? null,
    contact: contactPayload(created as LocalContact),
  };
}
