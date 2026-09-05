import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { getActiveImpersonation } from "@/lib/impersonation/session";
import { requirePartnerClientAccess } from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  AUTOMATION_PACKS,
  getAutomationPack,
} from "@/lib/automation-packs/catalog";
import {
  authenticationMatches,
  connectUrl,
  EmbeddedConnectionError,
  zapierConfiguration,
  zapierForIdentity,
  type ZapierField,
} from "@/lib/integrations/embedded/zapier";
import {
  connectionClient,
  loadEmbeddedConnection,
  type EmbeddedBinding,
} from "@/lib/integrations/embedded/runtime";
import {
  fieldPaths,
  mapFields,
  validateFields,
  validateInbound,
} from "@/lib/integrations/embedded/mapping";

export const dynamic = "force-dynamic";
const key = z.string().min(1).max(300);
const mapping = z.record(
  z.string().max(100),
  z.union([
    z.object({ path: key }).strict(),
    z.object({ value: z.unknown() }).strict(),
  ]),
);
const requestSchema = z
  .object({
    op: z.enum([
      "list",
      "search",
      "connect",
      "finish",
      "operations",
      "fields",
      "choices",
      "create",
      "test",
      "enable",
      "pause",
    ]),
    query: z.string().max(100).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
    appId: key.optional(),
    flowId: z.uuid().optional(),
    authenticationId: key.optional(),
    connectionId: z.uuid().optional(),
    bindingId: z.uuid().optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    actionKey: key.optional(),
    fieldId: key.optional(),
    packKey: key.optional(),
    eventType: key.optional(),
    templateKey: key.optional(),
    inputs: z.record(z.string().max(100), z.unknown()).default({}),
    mapping: mapping.default({}),
    runId: z.uuid().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Open this setup from your portal." },
      { status: 403 },
    );
  try {
    const { clientId } = await context.params;
    z.uuid().parse(clientId);
    const auth = await getAuthState();
    if (!auth.user)
      return Response.json(
        { error: "Sign in to manage connections." },
        { status: 401 },
      );
    if (await getActiveImpersonation(auth.user.id))
      return Response.json(
        { error: "App connections cannot be changed in a support session." },
        { status: 403 },
      );
    const db = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    if (!db || !admin)
      throw new EmbeddedConnectionError("Data service unavailable.", 503);
    const { data: client } = await db
      .from("client_businesses")
      .select("id,partner_id,status,default_runtime_mode")
      .eq("id", clientId)
      .single();
    if (!client)
      return Response.json({ error: "Client unavailable." }, { status: 403 });
    const access = await requirePartnerClientAccess(
      auth.user.id,
      client.partner_id,
      clientId,
      [
        "partner_owner",
        "partner_admin",
        "partner_implementer",
        "client_owner",
        "client_manager",
      ],
    );
    const clientOperator =
      ["client_owner", "client_manager"].includes(access.role) &&
      access.canOperateCustomerActions &&
      access.visibleClientSections.includes("settings");
    if (!access.canManageIntegrations && !clientOperator)
      return Response.json(
        { error: "Your role cannot manage connections." },
        { status: 403 },
      );
    const raw = await request.text();
    if (raw.length > 100_000)
      throw new EmbeddedConnectionError("Setup data is too large.", 413);
    const body = requestSchema.parse(JSON.parse(raw));
    const reply = (data: unknown) =>
      Response.json(data, { headers: { "Cache-Control": "no-store" } });
    const audit = async (action: string, targetId: string) =>
      recordAuditEvent({
        actor: access,
        action: `embedded.${action}`,
        targetType: "embedded_connection",
        targetId,
        summary: `Connected app setup: ${action.replaceAll("_", " ")}.`,
      });
    if (body.op === "list") {
      const config = zapierConfiguration();
      const [
        { data: connections },
        { data: bindings },
        { data: instances },
        { data: runs },
      ] = await Promise.all([
        admin
          .from("embedded_app_connections")
          .select(
            "id,app_title,app_id,connection:integration_connections(status,runtime_mode)",
          )
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .throwOnError(),
        admin
          .from("embedded_solution_bindings")
          .select(
            "id,connection_id,direction,pack_key,event_type,template_key,action_key,action_title,status,verified_at,last_success_at,last_error,field_mapping",
          )
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .throwOnError(),
        admin
          .from("client_workflow_instances")
          .select("template:workflow_templates(template_key,name)")
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .eq("status", "active")
          .throwOnError(),
        admin
          .from("workflow_runs")
          .select("id,summary,template:workflow_templates(template_key)")
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .in("status", ["succeeded", "paused_for_approval"])
          .order("started_at", { ascending: false })
          .limit(20)
          .throwOnError(),
      ]);
      return reply({
        configured: config.configured,
        connections,
        bindings,
        packs: AUTOMATION_PACKS,
        instances,
        runs,
        clientLive:
          client.status === "active" && client.default_runtime_mode === "live",
      });
    }
    if (!zapierConfiguration().configured)
      throw new EmbeddedConnectionError(
        "App connections are awaiting platform activation. Your existing direct connections remain available.",
        503,
      );
    if (["search", "connect", "finish"].includes(body.op)) {
      const api = await zapierForIdentity({
        partnerId: client.partner_id,
        clientId,
        userId: auth.user.id,
      });
      if (body.op === "search")
        return reply(await api.apps(body.query ?? "", body.offset));
      if (body.op === "connect") {
        const app = await api.app(z.string().parse(body.appId));
        const { data: flow } = await admin
          .from("embedded_connect_flows")
          .insert({
            partner_id: client.partner_id,
            client_id: clientId,
            user_id: auth.user.id,
            app_id: app.id,
            app_key: app.key,
            app_title: app.title,
          })
          .select("id")
          .single()
          .throwOnError();
        return reply({ url: await connectUrl(api, app.id), flowId: flow.id });
      }
      const { data: flow } = await admin
        .from("embedded_connect_flows")
        .select("app_id")
        .eq("id", body.flowId!)
        .eq("user_id", auth.user.id)
        .eq("partner_id", client.partner_id)
        .eq("client_id", clientId)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .single()
        .throwOnError();
      if (
        !(await api.authentications(flow.app_id)).some((item) =>
          authenticationMatches(item, flow.app_id, body.authenticationId ?? ""),
        )
      )
        throw new EmbeddedConnectionError(
          "The connected account could not be verified for this client and app.",
        );
      const { data: id } = await admin
        .rpc("finish_embedded_connection", {
          p_flow_id: body.flowId,
          p_user_id: auth.user.id,
          p_client_id: clientId,
          p_authentication_id: body.authenticationId,
        })
        .throwOnError();
      await audit("account_connected", id);
      return reply({ connectionId: id });
    }
    if (["pause", "enable", "test"].includes(body.op)) {
      const { data } = await admin
        .from("embedded_solution_bindings")
        .select("*")
        .eq("id", body.bindingId!)
        .eq("partner_id", client.partner_id)
        .eq("client_id", clientId)
        .single()
        .throwOnError();
      const binding = data as EmbeddedBinding;
      if (body.op === "pause") {
        await admin
          .from("embedded_solution_bindings")
          .update({ status: "paused" })
          .eq("id", binding.id)
          .throwOnError();
        await audit("solution_paused", binding.id);
        return reply({
          message:
            "Processing paused. Queued events are held; existing approvals remain visible and cannot execute while paused.",
        });
      }
      if (body.op === "enable") {
        if (!binding.verified_at)
          throw new EmbeddedConnectionError(
            "Test this solution with a real sample first.",
          );
        if (
          client.status !== "active" ||
          client.default_runtime_mode !== "live"
        )
          throw new EmbeddedConnectionError(
            "Complete the client launch checklist and make the client live before enabling this solution.",
          );
        await admin
          .from("integration_connections")
          .update({ runtime_mode: "live", status: "connected" })
          .eq("id", binding.connection_id)
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .throwOnError();
        await admin
          .from("embedded_solution_bindings")
          .update({ status: "enabled", last_error: null })
          .eq("id", binding.id)
          .eq("updated_at", binding.updated_at)
          .select("id")
          .single()
          .throwOnError();
        await audit("solution_enabled", binding.id);
        return reply({
          message: "Enabled. New external writes still require approval.",
        });
      }
      if (binding.status === "enabled")
        throw new EmbeddedConnectionError(
          "Pause the solution before changing its field mapping.",
        );
      const connection = await loadEmbeddedConnection(
        admin,
        binding.connection_id,
        client.partner_id,
        clientId,
      );
      const api = await connectionClient(admin, connection);
      let source: Record<string, unknown>;
      if (binding.direction === "inbound") {
        if (!binding.inbox_id)
          throw new EmbeddedConnectionError(
            "This subscription did not finish creating. Create a new setup.",
          );
        const lease = await api.lease(binding.inbox_id, 1);
        const sample = lease.results[0];
        if (!sample || !lease.lease_id)
          throw new EmbeddedConnectionError(
            "Create a sample event in the connected app, then test again. Polling sources may take a few minutes.",
          );
        source = sample.payload;
        // Preview is not consumption: return the sample to the inbox, with no
        // workflow execution or customer action during setup.
        await api.request(
          `/trigger-inbox/v1/inboxes/${encodeURIComponent(binding.inbox_id)}/messages/release`,
          { lease_id: lease.lease_id },
        );
        if (
          sample.message_attributes?.error_message ||
          sample.message_attributes?.possible_duplicate_data
        )
          throw new EmbeddedConnectionError(
            "This sample is incomplete or possibly duplicated. Review the source before proceeding.",
          );
      } else {
        const { data: run } = await admin
          .from("workflow_runs")
          .select(
            "input_snapshot,output_snapshot,summary,template:workflow_templates(template_key)",
          )
          .eq("id", body.runId!)
          .eq("partner_id", client.partner_id)
          .eq("client_id", clientId)
          .in("status", ["succeeded", "paused_for_approval"])
          .single()
          .throwOnError();
        const template = run.template as unknown as { template_key: string };
        if (
          template.template_key !== binding.template_key ||
          run.input_snapshot?.event_type !== binding.event_type
        )
          throw new EmbeddedConnectionError(
            "Choose a completed run for this solution and event.",
          );
        source = {
          input: run.input_snapshot?.data ?? {},
          output: run.output_snapshot?.output ?? {},
          summary: run.summary,
        };
      }
      const values = mapFields(source, body.mapping);
      let validationError: string | null = null;
      let testedFields: ZapierField[] | undefined;
      try {
        if (binding.direction === "inbound")
          validateInbound(
            getAutomationPack(binding.pack_key)!.requiredFields,
            values,
          );
        else {
          const action = await api.action(
            connection.app_id,
            binding.action_key,
            "WRITE",
          );
          testedFields = await api.fields(
            action.id,
            connection.authentication_id,
            values,
          );
          validateFields(testedFields, values);
        }
      } catch (error) {
        validationError =
          error instanceof Error ? error.message : "Review the field mapping.";
      }
      await admin
        .from("embedded_solution_bindings")
        .update({
          field_mapping: body.mapping,
          verified_at: validationError ? null : new Date().toISOString(),
          status: "draft",
          last_error: validationError,
        })
        .eq("id", binding.id)
        .eq("updated_at", binding.updated_at)
        .select("id")
        .single()
        .throwOnError();
      await audit("mapping_tested", binding.id);
      return reply({
        paths: fieldPaths(source),
        preview: values,
        validationError,
        fields: testedFields,
        message:
          validationError ??
          "Sample fields passed validation. Nothing was sent. Enable when the client is ready.",
      });
    }
    const connection = await loadEmbeddedConnection(
      admin,
      body.connectionId!,
      client.partner_id,
      clientId,
    );
    const api = await connectionClient(admin, connection);
    const type = body.direction === "inbound" ? "READ" : "WRITE";
    if (body.op === "operations")
      return reply({ data: await api.actions(connection.app_id, type) });
    const action = await api.action(connection.app_id, body.actionKey!, type);
    if (body.op === "fields")
      return reply({
        fields: await api.fields(
          action.id,
          connection.authentication_id,
          body.inputs,
        ),
        ...(type === "READ"
          ? {
              outputs: (
                await api.outputs(
                  action.id,
                  connection.authentication_id,
                  body.inputs,
                )
              ).data,
            }
          : {}),
      });
    if (body.op === "choices")
      return reply(
        await api.choices(
          action.id,
          body.fieldId!,
          connection.authentication_id,
          body.inputs,
        ),
      );
    const pack = getAutomationPack(body.packKey!);
    if (!pack || !pack.eventTypes.includes(body.eventType!))
      throw new EmbeddedConnectionError("Choose a supported solution event.");
    const { data: instances } = await admin
      .from("client_workflow_instances")
      .select("template:workflow_templates(template_key,trigger_events)")
      .eq("partner_id", client.partner_id)
      .eq("client_id", clientId)
      .eq("status", "active")
      .throwOnError();
    const supported = instances?.some((row) => {
      const template = row.template as unknown as {
        template_key: string;
        trigger_events: string[];
      };
      return (
        pack.workflowTemplates.includes(template.template_key) &&
        template.trigger_events.includes(body.eventType!) &&
        (type === "READ" || template.template_key === body.templateKey)
      );
    });
    if (!supported)
      throw new EmbeddedConnectionError(
        "Install the matching solution workflow for this client first. Some catalog solutions are still in development.",
      );
    const fields = await api.fields(
      action.id,
      connection.authentication_id,
      body.inputs,
    );
    if (
      fields.some(
        (field) =>
          ["PASSWORD", "CODE"].includes(field.format ?? "") ||
          field.type === "fieldset",
      )
    )
      throw new EmbeddedConnectionError(
        "This operation requires managed setup. Request it through support.",
      );
    if (type === "READ") validateFields(fields, body.inputs);
    const { data: binding } = await admin
      .from("embedded_solution_bindings")
      .insert({
        partner_id: client.partner_id,
        client_id: clientId,
        connection_id: connection.id,
        direction: body.direction,
        pack_key: pack.key,
        event_type: body.eventType,
        template_key: type === "WRITE" ? body.templateKey : null,
        action_key: action.key,
        action_title: action.title,
        inputs: type === "READ" ? body.inputs : {},
        field_mapping: body.mapping,
      })
      .select("id")
      .single()
      .throwOnError();
    if (type === "READ") {
      try {
        const inbox = await api.request<{ id: string }>(
          "/trigger-inbox/v1/inboxes",
          {
            name: `solution-${binding.id}`,
            subscription: {
              app_key: connection.app_key,
              action_key: action.key,
              connection_id: connection.authentication_id,
              inputs: body.inputs,
            },
          },
        );
        await admin
          .from("embedded_solution_bindings")
          .update({ inbox_id: inbox.id })
          .eq("id", binding.id)
          .throwOnError();
      } catch {
        await admin
          .from("embedded_solution_bindings")
          .update({
            status: "needs_attention",
            last_error: `Subscription creation needs reconciliation. Check provider inbox named solution-${binding.id} before making another subscription.`,
          })
          .eq("id", binding.id)
          .throwOnError();
        throw new EmbeddedConnectionError(
          "Subscription creation needs support review. It may already exist; do not create it again.",
        );
      }
    }
    await audit("solution_created", binding.id);
    return reply({
      bindingId: binding.id,
      message: "Setup saved. Map and test a sample before enabling.",
    });
  } catch (error) {
    if (error instanceof EmbeddedConnectionError)
      return Response.json(
        { error: error.message },
        {
          status:
            error.status >= 400 && error.status <= 599 ? error.status : 400,
        },
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "Review the setup fields and try again." },
        { status: 400 },
      );
    return Response.json(
      {
        error:
          "This operation could not be completed. Check your access, connection and setup fields, then try again.",
      },
      { status: 400 },
    );
  }
}
