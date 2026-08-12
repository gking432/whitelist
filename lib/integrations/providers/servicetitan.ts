import type {
  CanonicalObjectType,
  CanonicalRecord,
  ConnectorAdapter,
  ConnectorPage,
  ConnectorPushInput,
} from "../connectors/types";

export type ServiceTitanCredentials = {
  clientId: string;
  clientSecret: string;
  appKey: string;
  tenantId: string;
  businessUnitId: string;
  jobTypeId: string;
  environment?: "production" | "integration";
};

async function token(credentials: ServiceTitanCredentials) {
  const response = await fetch("https://auth.servicetitan.io/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`ServiceTitan authorization failed (${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token)
    throw new Error("ServiceTitan returned no access token.");
  return body.access_token;
}

async function stFetch(
  credentials: ServiceTitanCredentials,
  path: string,
  init: RequestInit = {},
) {
  const accessToken = await token(credentials);
  const host =
    credentials.environment === "integration"
      ? "https://api-integration.servicetitan.io"
      : "https://api.servicetitan.io";
  const response = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ST-App-Key": credentials.appKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`ServiceTitan API failed (${response.status}).`);
  return response;
}

export function mapServiceTitanCustomer(
  source: Record<string, unknown>,
): CanonicalRecord {
  const address = (source.address ?? {}) as Record<string, unknown>;
  const contacts = Array.isArray(source.contacts)
    ? (source.contacts as Record<string, unknown>[])
    : [];
  const contactValue = (types: string[]) =>
    contacts.find((contact) =>
      types.includes(
        String(contact.type ?? contact.contactType ?? "").toLowerCase(),
      ),
    )?.value;
  return {
    objectType: "customer",
    externalId: String(source.id ?? ""),
    updatedAt: typeof source.modifiedOn === "string" ? source.modifiedOn : null,
    data: {
      name: source.name ?? null,
      phone:
        source.phone ?? contactValue(["phone", "mobile", "landline"]) ?? null,
      email: source.email ?? contactValue(["email", "e-mail"]) ?? null,
      address:
        [address.street, address.unit, address.city, address.state, address.zip]
          .filter(Boolean)
          .join(", ") || null,
      balance: source.balance ?? null,
      active: source.active ?? null,
    },
    source,
  };
}

function mapServiceTitanJob(source: Record<string, unknown>): CanonicalRecord {
  return {
    objectType: "job",
    externalId: String(source.id ?? ""),
    updatedAt: typeof source.modifiedOn === "string" ? source.modifiedOn : null,
    data: {
      title: source.summary ?? source.jobTypeName ?? "Job",
      status: source.jobStatus ?? source.status ?? null,
      customer_id: source.customerId ?? null,
      location_id: source.locationId ?? null,
      appointment_ids: source.appointmentIds ?? [],
    },
    source,
  };
}

async function pull(
  credentials: ServiceTitanCredentials,
  objectType: CanonicalObjectType,
  cursor: Record<string, unknown> | null,
): Promise<ConnectorPage> {
  const page = typeof cursor?.page === "number" ? cursor.page : 1;
  const tenant = encodeURIComponent(credentials.tenantId);
  const path =
    objectType === "customer"
      ? `/crm/v2/tenant/${tenant}/customers?page=${page}&pageSize=100`
      : objectType === "job"
        ? `/jpm/v2/tenant/${tenant}/jobs?page=${page}&pageSize=100`
        : objectType === "appointment"
          ? `/jpm/v2/tenant/${tenant}/appointments?page=${page}&pageSize=100`
          : null;
  if (!path) throw new Error(`ServiceTitan cannot pull ${objectType}.`);
  const body = (await (await stFetch(credentials, path)).json()) as {
    data?: Record<string, unknown>[];
    hasMore?: boolean;
  };
  const records = (body.data ?? []).map((row) =>
    objectType === "customer"
      ? mapServiceTitanCustomer(row)
      : objectType === "job"
        ? mapServiceTitanJob(row)
        : {
            objectType: "appointment" as const,
            externalId: String(row.id ?? ""),
            updatedAt:
              typeof row.modifiedOn === "string" ? row.modifiedOn : null,
            data: {
              title: row.specialInstructions ?? "Appointment",
              status: row.status ?? null,
              start_at: row.start ?? row.startOn ?? null,
              end_at: row.end ?? row.endOn ?? null,
              job_id: row.jobId ?? null,
            },
            source: row,
          },
  );
  return { records, nextCursor: body.hasMore ? { page: page + 1 } : null };
}

async function push(
  credentials: ServiceTitanCredentials,
  input: ConnectorPushInput,
) {
  const tenant = encodeURIComponent(credentials.tenantId);
  if (input.objectType === "lead" && input.operation === "create") {
    const response = await stFetch(
      credentials,
      `/crm/v2/tenant/${tenant}/leads`,
      {
        method: "POST",
        body: JSON.stringify({
          customerId: input.data.customer_id ?? null,
          locationId: input.data.location_id ?? null,
          businessUnitId:
            input.data.business_unit_id ?? credentials.businessUnitId,
          jobTypeId: input.data.job_type_id ?? credentials.jobTypeId,
          priority: input.data.priority ?? "Normal",
          summary: input.data.description ?? input.data.summary ?? "New lead",
        }),
      },
    );
    const created = (await response.json()) as Record<string, unknown>;
    return { externalObjectId: String(created.id ?? ""), source: created };
  }
  throw new Error(
    `ServiceTitan cannot ${input.operation} ${input.objectType}.`,
  );
}

export const serviceTitanAdapter: ConnectorAdapter<ServiceTitanCredentials> = {
  manifest: {
    key: "servicetitan",
    name: "ServiceTitan",
    category: "field_service",
    description:
      "Customers, jobs, appointments, and lead intake for ServiceTitan.",
    authStrategy: "api_key",
    capabilities: [
      "customer.read",
      "job.read",
      "appointment.read",
      "lead.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://developer.servicetitan.io/docs/",
  },
  async testConnection(context) {
    try {
      const tenant = encodeURIComponent(context.credentials.tenantId);
      await stFetch(
        context.credentials,
        `/settings/v2/tenant/${tenant}/business-units?page=1&pageSize=1`,
      );
      return {
        ok: true,
        detail:
          "ServiceTitan connected. Customers, jobs, appointments, and leads are ready.",
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "ServiceTitan verification failed.",
      };
    }
  },
  pullPage(context, objectType, cursor) {
    return pull(context.credentials, objectType, cursor);
  },
  pushRecord(context, input) {
    return push(context.credentials, input);
  },
};
