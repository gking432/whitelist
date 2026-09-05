import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findCanonicalCallerMatch,
  type CanonicalCallerRow,
} from "./canonical-caller.ts";
import { readProviderCredentials } from "../integrations/credentials.ts";
import {
  findGoHighLevelContact,
  type GoHighLevelCredentials,
} from "../integrations/providers/gohighlevel.ts";
import {
  findHubSpotContact,
  type HubSpotCredentials,
} from "../integrations/providers/hubspot.ts";
import { normalizePhone } from "../phone/normalize.ts";

export type CallerResolution = {
  contactId: string | null;
  status: "matched" | "created" | "unavailable";
  provider: string | null;
  externalContactId: string | null;
  externalObjectType: "customer" | "lead" | null;
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

type ExternalContactMatch = {
  id: string;
  firstname: string | null;
  lastname: string | null;
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
      "id, runtime_mode, provider:integration_providers!inner(provider_key, category)",
    )
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("status", "connected")
    .order("created_at", { ascending: true })
    .limit(20);
  const connections = (data ?? []) as unknown as {
    id: string;
    runtime_mode: string;
    provider: { provider_key: string; category: string } | null;
  }[];

  // Canonical records are already in our database, so this lookup does not
  // call the vendor or mutate anything. It supports field-service systems
  // even when the client does not use Northstar as its primary CRM.
  for (const connection of connections) {
    if (connection.provider?.category !== "field_service") continue;
    const { data: records } = await admin
      .from("integration_canonical_records")
      .select(
        "object_type, external_object_id, native_object_id, canonical_data",
      )
      .eq("connection_id", connection.id)
      .in("object_type", ["customer", "lead"])
      .order("external_updated_at", { ascending: false })
      .limit(2_000);
    const canonical = findCanonicalCallerMatch(
      (records ?? []) as CanonicalCallerRow[],
      input.phone,
    );
    if (canonical) {
      return {
        connectionId: connection.id,
        provider: connection.provider.provider_key,
        match: canonical.match,
        objectType: canonical.objectType,
      };
    }
  }

  // HubSpot and GoHighLevel expose direct search. Keep outbound provider
  // reads behind live mode; dry-run connections never call their API.
  const connection = connections.find(
    (candidate) =>
      candidate.runtime_mode === "live" &&
      candidate.provider?.category === "crm" &&
      ["hubspot", "gohighlevel"].includes(
        candidate.provider?.provider_key ?? "",
      ),
  );
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
          provider: "hubspot",
          match,
          objectType: "customer" as const,
        }
      : null;
  }

  if (connection.provider.provider_key === "gohighlevel") {
    const credentials = await readProviderCredentials<GoHighLevelCredentials>(
      admin,
      connection.id,
    );
    const match = credentials
      ? await findGoHighLevelContact(credentials, { phone: input.phone })
      : null;

    return match
      ? {
          connectionId: connection.id,
          provider: "gohighlevel",
          match,
          objectType: "customer" as const,
        }
      : null;
  }

  return null;
}

async function findLocalExternalIdentity(
  admin: SupabaseClient,
  contactId: string,
): Promise<{
  connectionId: string;
  provider: string;
  externalContactId: string;
  externalObjectType: "customer" | "lead";
} | null> {
  const { data: legacy } = await admin
    .from("crm_contact_links")
    .select("connection_id, provider_key, external_contact_id, metadata")
    .eq("contact_id", contactId)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacy) {
    return {
      connectionId: legacy.connection_id,
      provider: legacy.provider_key,
      externalContactId: legacy.external_contact_id,
      externalObjectType:
        legacy.metadata?.external_object_type === "lead" ? "lead" : "customer",
    };
  }

  const { data } = await admin
    .from("integration_object_links")
    .select(
      "connection_id, object_type, external_object_id, connection:integration_connections!inner(provider:integration_providers!inner(provider_key))",
    )
    .eq("native_object_id", contactId)
    .in("object_type", ["customer", "lead"])
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const link = data as unknown as {
    connection_id: string;
    object_type: string;
    external_object_id: string;
    connection: { provider: { provider_key: string } | null } | null;
  } | null;
  const provider = link?.connection?.provider?.provider_key;
  return link && provider
    ? {
        connectionId: link.connection_id,
        provider,
        externalContactId: link.external_object_id,
        externalObjectType: link.object_type === "lead" ? "lead" : "customer",
      }
    : null;
}

async function linkExternalContact(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    contactId: string;
    connectionId: string;
    provider: string;
    externalContactId: string;
    externalObjectType: "customer" | "lead";
  },
) {
  await admin.from("crm_contact_links").upsert(
    {
      partner_id: input.partnerId,
      client_id: input.clientId,
      contact_id: input.contactId,
      connection_id: input.connectionId,
      provider_key: input.provider,
      external_contact_id: input.externalContactId,
      metadata: { external_object_type: input.externalObjectType },
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,external_contact_id" },
  );

  await admin.from("integration_object_links").upsert(
    {
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: input.connectionId,
      object_type: input.externalObjectType,
      native_object_id: input.contactId,
      external_object_id: input.externalContactId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,object_type,external_object_id" },
  );
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
      externalObjectType: null,
      contact: null,
    };
  }

  const local = await findLocalContact(admin, input.clientId, phone);

  if (local) {
    const linked = await findLocalExternalIdentity(admin, local.id);
    if (linked) {
      return {
        contactId: local.id,
        status: "matched",
        provider: linked.provider,
        externalContactId: linked.externalContactId,
        externalObjectType: linked.externalObjectType,
        contact: contactPayload(local),
      };
    }
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

  if (local) {
    if (external) {
      await linkExternalContact(admin, {
        partnerId: input.partnerId,
        clientId: input.clientId,
        contactId: local.id,
        connectionId: external.connectionId,
        provider: external.provider,
        externalContactId: external.match.id,
        externalObjectType: external.objectType,
      });
    }
    return {
      contactId: local.id,
      status: "matched",
      provider: external?.provider ?? "northstar",
      externalContactId: external?.match.id ?? null,
      externalObjectType: external?.objectType ?? null,
      contact: contactPayload(local),
    };
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
      externalObjectType: external?.objectType ?? null,
      contact: null,
    };
  }

  if (external) {
    await linkExternalContact(admin, {
      partnerId: input.partnerId,
      clientId: input.clientId,
      contactId: created.id,
      connectionId: external.connectionId,
      provider: external.provider,
      externalContactId: external.match.id,
      externalObjectType: external.objectType,
    });
  }

  return {
    contactId: created.id,
    status: external ? "matched" : "created",
    provider: external?.provider ?? "northstar",
    externalContactId: external?.match.id ?? null,
    externalObjectType: external?.objectType ?? null,
    contact: contactPayload(created as LocalContact),
  };
}
