import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { getAppUrl, getSecretsEncryptionKey } from "../env.ts";
import {
  buildHubSpotAuthorizationUrl, exchangeHubSpotOAuthCode, getHubSpotOAuthClient, HubSpotOAuthError,
  parseHubSpotPermissions, refreshHubSpotOAuthCredentials, verifyHubSpotToken,
  type HubSpotOAuthClient, type HubSpotOAuthCredentials,
} from "../integrations/providers/hubspot-oauth.ts";

type Scope = { partnerId: string; clientId: string };
type State = { provider: "hubspot"; attemptId: string; connectionId: string };
type Attempt = {
  id: string; partner_id: string; client_id: string; actor_id: string; connection_id: string;
  provider_key: string; purpose: string; cookie_hash: string; consumed_at: string | null; expires_at: string;
  encrypted_verifier: string; requested_permissions: unknown; expected_account_id: string | null;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const cookieName = (id: string) => `hubspot_oauth_${id}`;
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function signHubSpotOAuthState(state: State, secret = getSecretsEncryptionKey()): string {
  if (!secret || state.provider !== "hubspot" || !uuid(state.attemptId) || !uuid(state.connectionId)) throw new Error("HubSpot authorization state is unavailable.");
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function readHubSpotOAuthState(raw: string | null, secret = getSecretsEncryptionKey()): State | null {
  if (!secret || !raw || raw.length > 1500) return null;
  try {
    const parts = raw.split("."); if (parts.length !== 2) return null;
    const actual = Buffer.from(parts[1], "base64url"), expected = createHmac("sha256", secret).update(parts[0]).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = object(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    return value.provider === "hubspot" && uuid(value.attemptId) && uuid(value.connectionId) && Object.keys(value).length === 3 ? value as State : null;
  } catch { return null; }
}

/** Reconnect and consent buttons only add selected owner actions. Removing a
 * selection needs a separate explicit command; OAuth is never that command. */
export function hubSpotOAuthSelection(existing: { providerKey: unknown; config: unknown } | null, requested: unknown = []) {
  const added = parseHubSpotPermissions(requested);
  if (!existing) {
    if (added.length) throw new Error("Connect HubSpot read-only before selecting individual CRM actions.");
    return added;
  }
  const config = object(existing.config);
  if (existing.providerKey !== "hubspot" || config.hubspot_owner_crm !== true || config.workspace_view_only !== true)
    throw new Error("Reconnect the exact owner HubSpot account.");
  return parseHubSpotPermissions([...parseHubSpotPermissions(config.hubspot_selected_permissions ?? []), ...added]);
}

export async function startHubSpotOAuth(admin: SupabaseClient, scope: Scope, actorId: string, connectionId?: string, permissions: unknown = []) {
  const client = getHubSpotOAuthClient();
  if (!client) throw new Error("HubSpot app authorization is not configured.");
  let existing: Parameters<typeof hubSpotOAuthSelection>[0] = null;
  if (connectionId) {
    const { data, error } = await admin.from("integration_connections")
      .select("id,partner_id,client_id,config,provider:integration_providers!inner(provider_key)")
      .eq("id", connectionId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("provider.provider_key", "hubspot").maybeSingle();
    if (error || !data || data.id !== connectionId || data.partner_id !== scope.partnerId || data.client_id !== scope.clientId)
      throw new Error("The exact owner HubSpot account is unavailable.");
    const provider = object(Array.isArray(data.provider) ? data.provider[0] : data.provider);
    existing = { providerKey: provider.provider_key, config: data.config };
  }
  const selected = hubSpotOAuthSelection(existing, permissions);
  const { encryptSecret } = await import("../integrations/secrets.ts");
  const cookie = randomBytes(32).toString("base64url");
  // This encrypted nonce binds app configuration to the attempt. It is not a
  // claim that ordinary HubSpot app OAuth implements MCP's PKCE flow.
  const verifier = encryptSecret(JSON.stringify({ clientId: client.clientId, redirectUri: client.redirectUri, nonce: randomBytes(32).toString("base64url") }));
  const { data, error } = await admin.rpc("begin_hubspot_oauth", { p_partner: scope.partnerId, p_client: scope.clientId, p_actor: actorId,
    p_connection: connectionId ?? null, p_cookie_hash: digest(cookie), p_encrypted_verifier: verifier,
    p_permissions: selected, p_expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
  if (error || !data || !uuid(data.attemptId) || !uuid(data.connectionId) || !(data.expectedAccountId === null || typeof data.expectedAccountId === "string"))
    throw new Error("The scoped HubSpot authorization attempt could not be prepared.");
  const state = signHubSpotOAuthState({ provider: "hubspot", attemptId: data.attemptId, connectionId: data.connectionId });
  return { cookie, cookieName: cookieName(data.attemptId), url: buildHubSpotAuthorizationUrl(client, state, selected, data.expectedAccountId) };
}

export type HubSpotCompletionStore = {
  consume(input: Scope & { actorId: string; state: State; cookieHash: string; now: string }): Promise<Attempt | null>;
  finish(attemptId: string, credentials: HubSpotOAuthCredentials): Promise<void>;
  retire(attemptId: string): Promise<void>;
};
/** Injectable callback protocol; denied/incomplete attempts never touch an old
 * grant. Provider account and selected scopes are independently inspected. */
export async function completeHubSpotOAuthAttempt(input: Scope & { actorId: string; state: State; cookie: string; code: string | null; denied: boolean }, deps: {
  client: HubSpotOAuthClient; store: HubSpotCompletionStore; now?: () => string;
  exchange?: typeof exchangeHubSpotOAuthCode; decrypt?: (value: string) => string;
}): Promise<"connected" | "denied" | "expired" | "changed" | "failed"> {
  const now = deps.now?.() ?? new Date().toISOString();
  const attempt = await deps.store.consume({ ...input, cookieHash: digest(input.cookie), now });
  if (!attempt) return "expired";
  try {
    if (attempt.id !== input.state.attemptId || attempt.connection_id !== input.state.connectionId || attempt.provider_key !== "hubspot" || attempt.purpose !== "hubspot_oauth" ||
        attempt.partner_id !== input.partnerId || attempt.client_id !== input.clientId || attempt.actor_id !== input.actorId || attempt.cookie_hash !== digest(input.cookie) ||
        !attempt.consumed_at || !Number.isFinite(Date.parse(attempt.expires_at)) || Date.parse(attempt.expires_at) <= Date.parse(now)) return "expired";
    if (input.denied || !input.code) return "denied";
    const decrypt = deps.decrypt ?? (await import("../integrations/secrets.ts")).decryptSecret;
    const savedApp = object(JSON.parse(decrypt(attempt.encrypted_verifier)));
    if (savedApp.clientId !== deps.client.clientId || savedApp.redirectUri !== deps.client.redirectUri || typeof savedApp.nonce !== "string") return "changed";
    const credentials = await (deps.exchange ?? exchangeHubSpotOAuthCode)(deps.client, input.code, parseHubSpotPermissions(attempt.requested_permissions), attempt.expected_account_id);
    credentials.grantRevision = randomUUID();
    await deps.store.finish(attempt.id, credentials);
    return "connected";
  } catch { return "failed"; }
  // Consumption already prevents replay. Cleanup cannot undo a committed grant.
  finally { await deps.store.retire(attempt.id).catch(() => undefined); }
}

function completionStore(admin: SupabaseClient): HubSpotCompletionStore {
  return {
    async consume(input) {
      const { data, error } = await admin.from("business_connection_oauth_attempts").update({ consumed_at: input.now })
        .eq("id", input.state.attemptId).eq("partner_id", input.partnerId).eq("client_id", input.clientId).eq("actor_id", input.actorId)
        .eq("connection_id", input.state.connectionId).eq("provider_key", "hubspot").eq("purpose", "hubspot_oauth")
        .eq("cookie_hash", input.cookieHash).is("consumed_at", null).gt("expires_at", input.now).select("*").maybeSingle();
      if (error) throw new Error("The HubSpot attempt could not be consumed.");
      return data as Attempt | null;
    },
    async finish(attemptId, credentials) {
      const { encryptSecret } = await import("../integrations/secrets.ts");
      const { error } = await admin.rpc("finish_hubspot_oauth", { p_attempt: attemptId, p_encrypted: encryptSecret(JSON.stringify(credentials)), p_last_four: credentials.refreshToken.slice(-4),
        p_account_id: credentials.accountId, p_account_name: credentials.accountName, p_verified_scopes: credentials.scopes,
        p_permissions: credentials.permissions, p_expires_at: credentials.expiresAt, p_grant_revision: credentials.grantRevision });
      if (error) throw new Error("The HubSpot account changed before authorization could be saved.");
    },
    async retire(attemptId) {
      const { error } = await admin.from("business_connection_oauth_attempts").delete().eq("id", attemptId).not("consumed_at", "is", null);
      if (error) throw new Error("The consumed HubSpot attempt could not be retired.");
    },
  };
}

export async function completeHubSpotOAuth(request: NextRequest): Promise<NextResponse> {
  const { NextResponse, after } = await import("next/server");
  const state = readHubSpotOAuthState(request.nextUrl.searchParams.get("state"));
  const finish = (outcome: string) => {
    const url = new URL("/client/apps", getAppUrl()); url.searchParams.set("connection", outcome); url.searchParams.set("provider", "hubspot");
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    if (state) response.cookies.delete(cookieName(state.attemptId));
    return response;
  };
  if (!state) return finish("expired");
  const [{ getAuthState }, { loadClientPortal }, { canWriteBusinessWorkspace }, { createSupabaseAdminClient }] = await Promise.all([
    import("../auth/session.ts"), import("../clients/portal.ts"), import("../business/access.ts"), import("../supabase/admin.ts"),
  ]);
  const { user } = await getAuthState(), portal = user ? await loadClientPortal() : null;
  if (!user || portal?.kind !== "ok" || !canWriteBusinessWorkspace(portal.access) || portal.access.isImpersonating) return finish("sign_in_required");
  const admin = createSupabaseAdminClient(), client = getHubSpotOAuthClient();
  if (!admin || !client) return finish("unavailable");
  const cookie = request.cookies.get(cookieName(state.attemptId))?.value;
  if (!cookie) return finish("expired");
  let outcome: string;
  try {
    outcome = await completeHubSpotOAuthAttempt({ partnerId: portal.client.partner_id, clientId: portal.client.id, actorId: user.id, state, cookie,
      code: request.nextUrl.searchParams.get("code"), denied: request.nextUrl.searchParams.has("error") }, { client, store: completionStore(admin) });
  } catch { return finish("failed"); }
  if (outcome === "connected") {
    const { enqueueInitialConnectorSync, processConnectorSyncJobs } = await import("../integrations/connectors/sync-runner.ts");
    try { await enqueueInitialConnectorSync(admin, { partnerId: portal.client.partner_id, clientId: portal.client.id, connectionId: state.connectionId, providerKey: "hubspot" }); }
    catch { return finish("sync_pending"); }
    after(async () => { await processConnectorSyncJobs(4, { connectionId: state.connectionId, readOnly: true }); });
  }
  return finish(outcome);
}

export type HubSpotCredentialSnapshot = { credentials: HubSpotOAuthCredentials; secretRevision: string };
export type HubSpotRefreshStore = {
  read(): Promise<HubSpotCredentialSnapshot>;
  claim(revision: string, claim: string): Promise<boolean>;
  finish(revision: string, claim: string, updated: HubSpotOAuthCredentials, newRevision: string): Promise<boolean>;
  fail(revision: string, claim: string, reauth: boolean): Promise<void>;
};
/** Rotated secrets must commit under the exact lease and secret revision before
 * any connector can use them. Concurrent reconnect/disconnect always wins. */
export async function loadHubSpotOAuthCredentialsFromStore(store: HubSpotRefreshStore, deps: {
  client: HubSpotOAuthClient; now?: () => string; refresh?: typeof refreshHubSpotOAuthCredentials; verify?: typeof verifyHubSpotToken;
}): Promise<HubSpotOAuthCredentials> {
  const now = deps.now?.() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("The HubSpot credential clock is invalid.");
  for (let retry = 0; retry < 2; retry++) {
    const saved = await store.read(), credentials = saved.credentials;
    if (Date.parse(credentials.expiresAt) > Date.parse(now) + 60_000) {
      try {
        await (deps.verify ?? verifyHubSpotToken)(credentials, { client: deps.client, expectedAccountId: credentials.accountId });
        const current = await store.read();
        if (current.secretRevision !== saved.secretRevision || current.credentials.grantRevision !== credentials.grantRevision) continue;
        return credentials;
      } catch (error) {
        if (error instanceof HubSpotOAuthError && error.reauth) {
          const claim = randomUUID(); if (await store.claim(saved.secretRevision, claim)) await store.fail(saved.secretRevision, claim, true);
        }
        throw error;
      }
    }
    const claim = randomUUID();
    if (!await store.claim(saved.secretRevision, claim)) {
      const current = await store.read();
      if (current.secretRevision !== saved.secretRevision) continue;
      throw new HubSpotOAuthError("HubSpot token refresh is already in progress. Retry after the current refresh finishes.", false, true);
    }
    try {
      const updated = await (deps.refresh ?? refreshHubSpotOAuthCredentials)(deps.client, credentials);
      if (!await store.finish(saved.secretRevision, claim, updated, randomUUID())) throw new HubSpotOAuthError("The refreshed HubSpot grant could not be committed. Reconnect or review the current account.", true);
      return updated;
    } catch (error) {
      const reauth = error instanceof HubSpotOAuthError ? error.reauth : true;
      await store.fail(saved.secretRevision, claim, reauth).catch(() => undefined);
      throw error;
    }
  }
  throw new HubSpotOAuthError("The HubSpot grant changed while it was being checked. Retry the current account.", false, true);
}

export async function loadHubSpotOAuthCredentials(admin: SupabaseClient, scope: Scope, connectionId: string): Promise<HubSpotOAuthCredentials> {
  const client = getHubSpotOAuthClient();
  if (!client) throw new HubSpotOAuthError("HubSpot OAuth is not configured.", true);
  const parameters = (revision: string, claim: string) => ({ p_partner: scope.partnerId, p_client: scope.clientId, p_connection: connectionId, p_expected_secret_revision: revision, p_claim: claim });
  const store: HubSpotRefreshStore = {
    async read() {
      const [connection, secret] = await Promise.all([
        admin.from("integration_connections").select("status,runtime_mode,credential_status,external_account_id,config,provider:integration_providers!inner(provider_key)")
          .eq("id", connectionId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("provider.provider_key", "hubspot").maybeSingle(),
        admin.from("integration_secrets").select("encrypted_value").eq("connection_id", connectionId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("secret_kind", "provider_credentials").maybeSingle(),
      ]);
      const c = connection.data, config = object(c?.config);
      if (connection.error || secret.error || !c || !secret.data || !["connected", "needs_attention"].includes(c.status) || c.runtime_mode === "paused" || c.credential_status !== "configured" ||
          config.hubspot_owner_crm !== true || config.workspace_view_only !== true || !uuid(config.hubspot_secret_revision) || !uuid(config.hubspot_grant_revision))
        throw new HubSpotOAuthError("The exact HubSpot OAuth account is paused, disconnected or needs reauthorization.", true);
      const { decryptSecret } = await import("../integrations/secrets.ts");
      const credentials = object(JSON.parse(decryptSecret(secret.data.encrypted_value))) as unknown as HubSpotOAuthCredentials;
      const selected = parseHubSpotPermissions(config.hubspot_selected_permissions);
      if (credentials.authType !== "oauth" || credentials.clientId !== client.clientId || credentials.accountId !== c.external_account_id ||
          credentials.grantRevision !== config.hubspot_grant_revision || !Array.isArray(credentials.scopes) || !Number.isFinite(Date.parse(credentials.expiresAt)) ||
          JSON.stringify(parseHubSpotPermissions(credentials.permissions)) !== JSON.stringify(selected) || credentials.accessMode !== (selected.length ? "owner_selected" : "read_only"))
        throw new HubSpotOAuthError("The saved HubSpot account and reviewed grant no longer agree.", true);
      return { credentials, secretRevision: config.hubspot_secret_revision };
    },
    async claim(revision, claim) { const r = await admin.rpc("claim_hubspot_oauth_refresh", parameters(revision, claim)); if (r.error) throw new Error("The HubSpot refresh lease could not be checked."); return r.data === true; },
    async finish(revision, claim, updated, newRevision) {
      const { encryptSecret } = await import("../integrations/secrets.ts");
      const r = await admin.rpc("finish_hubspot_oauth_refresh", { ...parameters(revision, claim), p_encrypted: encryptSecret(JSON.stringify(updated)), p_last_four: updated.refreshToken.slice(-4),
        p_account_id: updated.accountId, p_verified_scopes: updated.scopes, p_expires_at: updated.expiresAt, p_new_secret_revision: newRevision });
      if (r.error) throw new Error("The rotated HubSpot credentials could not be committed."); return r.data === true;
    },
    async fail(revision, claim, reauth) { const r = await admin.rpc("fail_hubspot_oauth_refresh", { ...parameters(revision, claim), p_reauth: reauth }); if (r.error) throw new Error("HubSpot credential recovery could not be recorded."); },
  };
  return loadHubSpotOAuthCredentialsFromStore(store, { client });
}
