import { createPrivateKey, createPublicKey, sign } from "node:crypto";

export type ZapierIdentity = {
  partnerId: string;
  clientId: string;
  userId: string;
};
export type ZapierApp = {
  id: string;
  key: string;
  title: string;
  description?: string;
};
export type ZapierAction = {
  id: string;
  key: string;
  title: string;
  action_type: string;
  is_instant?: boolean;
};
export type ZapierField = {
  id: string;
  type: string;
  title: string;
  is_required?: boolean;
  format?: string;
  value_type?: string;
  depends_on?: string[];
  invalidates_input_fields?: boolean;
};
export type ZapierAuthentication = {
  id: string;
  app: string | { id: string };
  title: string;
  is_expired: boolean;
};
export type InboxMessage = {
  id: string;
  payload: Record<string, unknown>;
  message_attributes?: {
    error_message?: string;
    possible_duplicate_data?: boolean;
  };
};
export type InboxLease = {
  lease_id: string | null;
  results: InboxMessage[];
  inbox_attributes?: { status: string; paused_reason?: string };
};
export type ZapierRun = {
  id?: string;
  status: "success" | "error" | "waiting";
  errors?: unknown[];
};

export class EmbeddedConnectionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const REQUIRED = [
  "ZAPIER_WHITE_LABEL_CLIENT_ID",
  "ZAPIER_WHITE_LABEL_CLIENT_SECRET",
  "ZAPIER_WHITE_LABEL_PRIVATE_KEY",
  "ZAPIER_WHITE_LABEL_KEY_ID",
  "ZAPIER_WHITE_LABEL_ISSUER",
  "ZAPIER_WHITE_LABEL_SCOPES",
] as const;
export function zapierConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    configured: REQUIRED.every((key) => Boolean(env[key]?.trim())),
    missing: REQUIRED.filter((key) => !env[key]?.trim()),
  };
}

export function partnerJwt(
  identity: ZapierIdentity,
  env: Record<string, string | undefined> = process.env,
  now = Math.floor(Date.now() / 1000),
) {
  if (!zapierConfiguration(env).configured)
    throw new EmbeddedConnectionError(
      "App connections are awaiting platform activation.",
      503,
    );
  // Keep the authorizing person stable for background execution. Client scope,
  // not agency scope, is the external workspace boundary.
  const header = Buffer.from(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
      kid: env.ZAPIER_WHITE_LABEL_KEY_ID,
    }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      sub: identity.userId,
      org_id: `${identity.partnerId}:${identity.clientId}`,
      iss: env.ZAPIER_WHITE_LABEL_ISSUER,
      aud: "connect.zapier.com",
      iat: now,
      nbf: now,
      exp: now + 300,
    }),
  ).toString("base64url");
  const key = createPrivateKey(
    env.ZAPIER_WHITE_LABEL_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  );
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new EmbeddedConnectionError(
      "App connection signing key must be RSA with at least 2048 bits.",
      503,
    );
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key).toString("base64url")}`;
}

export function zapierJwks(
  env: Record<string, string | undefined> = process.env,
) {
  if (!env.ZAPIER_WHITE_LABEL_PRIVATE_KEY || !env.ZAPIER_WHITE_LABEL_KEY_ID)
    return { keys: [] };
  const key = createPublicKey(
    env.ZAPIER_WHITE_LABEL_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ).export({ format: "jwk" });
  // Public material only. Optional previous public keys permit staged rotation.
  const previous = JSON.parse(
    env.ZAPIER_WHITE_LABEL_PREVIOUS_PUBLIC_JWKS || '{"keys":[]}',
  ) as { keys: Array<{ kty: string; kid: string; n: string; e: string }> };
  return {
    keys: [
      {
        kty: key.kty,
        n: key.n,
        e: key.e,
        kid: env.ZAPIER_WHITE_LABEL_KEY_ID,
        alg: "RS256",
        use: "sig",
      },
      ...previous.keys.map(({ kty, kid, n, e }) => ({
        kty,
        kid,
        n,
        e,
        alg: "RS256",
        use: "sig",
      })),
    ],
  };
}

export function authenticationMatches(
  auth: ZapierAuthentication,
  appId: string,
  authenticationId: string,
) {
  return (
    auth.id === authenticationId &&
    !auth.is_expired &&
    (typeof auth.app === "string" ? auth.app : auth.app.id) === appId
  );
}

export class ZapierClient {
  readonly token: string;
  private readonly fetcher: typeof fetch;
  constructor(token: string, fetcher: typeof fetch = fetch) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (!path.startsWith("/v2/") && !path.startsWith("/trigger-inbox/v1/"))
      throw new Error("Invalid Zapier API path.");
    const response = await this.fetcher(`https://api.zapier.com${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new EmbeddedConnectionError(
        response.status === 401 || response.status === 403
          ? "Reconnect the app or check platform access with your administrator."
          : response.status === 429
            ? "The connection service is busy. Try again shortly."
            : `Connection service request failed (${response.status}).`,
        response.status,
      );
    return (await response.json()) as T;
  }
  async apps(query: string, offset = 0) {
    return this.request<{ data: ZapierApp[] }>(
      `/v2/apps?${new URLSearchParams({ query, offset: String(offset), limit: "20" })}`,
    );
  }
  async app(id: string) {
    const result = await this.request<{ data: ZapierApp[] }>(
      `/v2/apps?${new URLSearchParams({ ids: id })}`,
    );
    const app = result.data.find((item) => item.id === id);
    if (!app) throw new EmbeddedConnectionError("This app is unavailable.");
    return app;
  }
  async actions(app: string, type: "READ" | "WRITE") {
    const page = await this.request<{ data: ZapierAction[] }>(
      `/v2/actions?${new URLSearchParams({ app, action_type: type })}`,
    );
    return page.data;
  }

  async action(app: string, key: string, type: "READ" | "WRITE") {
    const action = (await this.actions(app, type)).find(
      (item) => item.key === key && item.action_type === type,
    );
    if (!action)
      throw new EmbeddedConnectionError(
        "The selected operation is no longer available. Review the connection setup.",
      );
    return action;
  }
  async authentications(app: string) {
    const all: ZapierAuthentication[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await this.request<{ data: ZapierAuthentication[] }>(
        `/v2/authentications?${new URLSearchParams({ app, limit: "100", offset: String(offset) })}`,
      );
      all.push(...page.data);
      if (page.data.length < 100) return all;
    }
    throw new EmbeddedConnectionError(
      "Too many connected accounts. Contact platform support.",
    );
  }
  async fields(
    actionId: string,
    authentication: string,
    inputs: Record<string, unknown>,
  ) {
    return (
      await this.request<{ data: ZapierField[] }>(
        `/v2/actions/${encodeURIComponent(actionId)}/inputs`,
        { data: { authentication, inputs } },
      )
    ).data;
  }
  async choices(
    actionId: string,
    fieldId: string,
    authentication: string,
    inputs: Record<string, unknown>,
  ) {
    return this.request<{ data: Array<{ id: string; label: string }> }>(
      `/v2/actions/${encodeURIComponent(actionId)}/inputs/${encodeURIComponent(fieldId)}/choices`,
      { data: { authentication, inputs } },
    );
  }
  async outputs(
    actionId: string,
    authentication: string,
    inputs: Record<string, unknown>,
  ) {
    return this.request<{ data: Array<{ id: string; title?: string }> }>(
      `/v2/actions/${encodeURIComponent(actionId)}/outputs`,
      { data: { authentication, inputs } },
    );
  }
  lease(inboxId: string, limit = 10) {
    return this.request<InboxLease>(
      `/trigger-inbox/v1/inboxes/${encodeURIComponent(inboxId)}/messages/lease`,
      { lease_seconds: 300, lease_limit: limit },
    );
  }
  ack(inboxId: string, leaseId: string, messageIds: string[]) {
    return this.request(
      `/trigger-inbox/v1/inboxes/${encodeURIComponent(inboxId)}/messages/ack`,
      { lease_id: leaseId, message_ids: messageIds },
    );
  }
  run(id: string) {
    return this.request<{ data: ZapierRun }>(
      `/v2/action-runs/${encodeURIComponent(id)}/`,
    );
  }
}

async function exchange(
  values: Record<string, string>,
  env: Record<string, string | undefined>,
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://zapier.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: env.ZAPIER_WHITE_LABEL_CLIENT_ID!,
      client_secret: env.ZAPIER_WHITE_LABEL_CLIENT_SECRET!,
      ...values,
    }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new EmbeddedConnectionError(
      "The platform connection service could not authorize this client. Contact platform support.",
      503,
    );
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token)
    throw new EmbeddedConnectionError(
      "The connection service returned no access token.",
      503,
    );
  return body.access_token;
}

export async function zapierForIdentity(
  identity: ZapierIdentity,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const token = await exchange(
    {
      subject_token: partnerJwt(identity, env),
      subject_token_type: "urn:ietf:params:oauth:token-type:external-jwt",
      requested_token_type: "urn:ietf:params:oauth:token-type:access-token",
      scope: env.ZAPIER_WHITE_LABEL_SCOPES!,
    },
    env,
    fetcher,
  );
  return new ZapierClient(token, fetcher);
}

export async function connectUrl(
  client: ZapierClient,
  appId: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const resource = `https://connect.zapier.com/to/${encodeURIComponent(appId)}`;
  const token = await exchange(
    {
      subject_token: client.token,
      subject_token_type: "urn:ietf:params:oauth:token-type:access-token",
      requested_token_type: "urn:ietf:params:oauth:token-type:connect-token",
      scope: "connection:write",
      resource,
    },
    env,
    fetcher,
  );
  return `${resource}?${new URLSearchParams({ token })}`;
}
