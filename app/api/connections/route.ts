import { startHubSpotOAuth } from "@/lib/connections/hubspot-oauth";
import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { connectionsContext } from "@/lib/connections/context";
import { readConnectedData } from "@/lib/connections/data";
import { startGooglePermissionUpgrade, startReadOnlyOAuth } from "@/lib/connections/oauth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { OWNER_PROVIDERS } from "@/lib/connections/types";
import { readOwnerProviderOptions } from "@/lib/connections/provider-options";
import { prepareOwnerIntake } from "@/lib/connections/intake-setup";
import { prepareStripeSetup } from "@/lib/connections/provider-setup";
import {
  enqueueInitialConnectorSync,
  processConnectorSyncJobs,
} from "@/lib/integrations/connectors/sync-runner";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upgrade_hubspot_permissions"), connectionId: z.uuid(), permissions: z.array(z.enum(["contact.create", "note.create"])).max(2).refine((a)=>new Set(a).size===a.length) }).strict(),
  z.object({ action: z.literal("configure_hubspot"), connectionId: z.uuid(), expectedRevision: z.string().min(1).max(100), selectedCrm: z.boolean(), actionsEnabled: z.boolean() }).strict(),
  z.object({ action: z.literal("upgrade_google_permissions"), connectionId: z.uuid(), permissions: z.array(z.enum(["calendar.write", "email.send"])).min(1).max(2).refine((items) => new Set(items).size === items.length) }).strict(),
  z.object({ action: z.literal("connect"), provider: z.enum(OWNER_PROVIDERS).default("google_workspace"), connectionId: z.uuid().optional(), permissions: z.array(z.enum(["contact.create", "note.create"])).max(2).optional() }).strict(),
  z.object({ action: z.literal("prepare_intake"), key: z.uuid() }).strict(),
  z
    .object({
      action: z.enum(["refresh", "pause", "resume", "disconnect"]),
      connectionId: z.uuid(),
    })
    .strict(),
]);
export async function GET() {
  const ctx = await connectionsContext();
  if (!ctx)
    return NextResponse.json(
      { error: "Sign in with business owner access." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  return NextResponse.json({ ...(await readConnectedData(admin, ctx.scope)), providers: readOwnerProviderOptions(), canWrite: canWriteBusinessWorkspace(ctx.portal.access) && !ctx.portal.access.isImpersonating }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const ctx = await connectionsContext(true);
  if (!ctx)
    return NextResponse.json(
      { error: "Sign in with business owner access." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  const raw = await request.text();
  if (raw.length > 4000)
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const parsed = Input.safeParse(
    (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid connection request." },
      { status: 400 },
    );
  const input = parsed.data;
  try {
    if (input.action === "configure_hubspot") {
      const result = await admin.rpc("configure_hubspot", { p_partner: ctx.scope.partnerId, p_client: ctx.scope.clientId, p_connection: input.connectionId, p_expected_revision: input.expectedRevision, p_selected: input.selectedCrm, p_enabled: input.actionsEnabled });
      if (result.error) throw new Error("Refresh the exact HubSpot settings before saving.");
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "upgrade_hubspot_permissions" || (input.action === "connect" && input.provider === "hubspot")) {
      const auth = await startHubSpotOAuth(admin, ctx.scope, ctx.user.id, input.connectionId, input.permissions ?? []);
      const response = NextResponse.json({ url: auth.url }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(auth.cookieName, auth.cookie, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 900 });
      return response;
    }
    if (input.action === "upgrade_google_permissions") {
      const auth = await startGooglePermissionUpgrade(admin, ctx.scope, ctx.user.id, input.connectionId, input.permissions);
      const response = NextResponse.json({ url: auth.url }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(auth.cookieName, auth.cookie, {
        httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 900,
      });
      return response;
    }
    if (input.action === "prepare_intake") {
      const intake = readOwnerProviderOptions().find((provider) => provider.key === "generic_inbound_webhook");
      if (!intake?.available) return NextResponse.json({ error: intake?.detail ?? "Secure intake setup is unavailable." }, { status: 503 });
      return NextResponse.json(await prepareOwnerIntake(admin, ctx.scope, ctx.user.id, input.key), { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "connect") {
      if (input.provider === "stripe") {
        const stripe = readOwnerProviderOptions().find((provider) => provider.key === "stripe");
        if (!stripe?.available) return NextResponse.json({ error: stripe?.detail ?? "Secure Stripe setup is unavailable." }, { status: 503 });
        return NextResponse.json(await prepareStripeSetup(admin, ctx.scope, ctx.user.id), { headers: { "Cache-Control": "no-store" } });
      }
      if (!["google_workspace", "microsoft_365"].includes(input.provider))
        return NextResponse.json({ error: "Prepare a form endpoint before configuring your form server." }, { status: 422 });
      const option = readOwnerProviderOptions().find((provider) => provider.key === input.provider);
      if (!option?.available)
        return NextResponse.json(
          {
            error:
              option?.detail ?? "Provider setup is unavailable.",
          },
          { status: 503 },
        );
      const auth = await startReadOnlyOAuth(admin, ctx.scope, ctx.user.id, input.provider as "google_workspace" | "microsoft_365", input.connectionId);
      const response = NextResponse.json(
        { url: auth.url },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(auth.cookieName, auth.cookie, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      });
      return response;
    }
    const { data: conn } = await admin
      .from("integration_connections")
      .select("id,config,status,runtime_mode,provider:integration_providers!inner(provider_key)")
      .eq("id", input.connectionId)
      .eq("partner_id", ctx.scope.partnerId)
      .eq("client_id", ctx.scope.clientId)
      .maybeSingle()
      .throwOnError();
    if (!conn)
      return NextResponse.json(
        { error: "Connection not found." },
        { status: 404 },
      );
    const providerKey = (conn.provider as unknown as { provider_key: string }).provider_key;
    if (!OWNER_PROVIDERS.includes(providerKey as never) ||
      (["google_workspace", "microsoft_365"].includes(providerKey) && conn.config?.workspace_view_only !== true))
      return NextResponse.json({ error: "Manage this agent-enabled account through its integration settings." }, { status: 422 });
    if (input.action !== "refresh") {
      const result = await admin.rpc("manage_readonly_workspace_connection", {
        p_partner: ctx.scope.partnerId,
        p_client: ctx.scope.clientId,
        p_connection: conn.id,
        p_action: input.action,
      });
      if (result.error)
        throw new Error(
          "The connection could not be changed. Reconnect the account if authorization has expired.",
        );
    }
    if (input.action === "refresh" || input.action === "resume") {
      if (providerKey === "generic_inbound_webhook") return NextResponse.json({ ok: true, message: "Form intake status saved. New submissions arrive through its configured endpoint." }, { headers: { "Cache-Control": "no-store" } });
      if (
        input.action === "refresh" &&
        (conn.status !== "connected" || conn.runtime_mode === "paused")
      )
        throw new Error("Resume or reconnect the account before refreshing.");
      // Bring the existing poll forward; retain its cursor and avoid duplicate import streams.
      await admin
        .from("integration_sync_jobs")
        .update({ scheduled_for: new Date().toISOString() })
        .eq("connection_id", conn.id)
        .eq("partner_id", ctx.scope.partnerId)
        .eq("client_id", ctx.scope.clientId)
        .eq("direction", "pull")
        .in("status", ["queued", "failed"])
        .throwOnError();
      await enqueueInitialConnectorSync(admin, {
        ...ctx.scope,
        connectionId: conn.id,
        providerKey,
      });
      after(async () => {
        await processConnectorSyncJobs(4, {
          connectionId: conn.id,
          readOnly: true,
        });
      });
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "The connection could not be updated. Check setup, resume or reconnect the account and try again.",
      },
      { status: 400 },
    );
  }
}
