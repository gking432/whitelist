import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "./access";
import { BUSINESS_RECIPES } from "./catalog";
import { PROFILE_SCHEMA, RECORD_SCHEMA } from "./rules";
import { createBusinessRecord, runBusinessRecipe } from "./engine";
import { parseBusinessProfileSaveReceipt, type MutationResult } from "./types";
import { validateGoalLink } from "./record-links";

const uuid = z.uuid();
const profileKeys = Object.keys(PROFILE_SCHEMA.shape);
export const SaveBusinessProfileCommandSchema = z.object({ action: z.literal("save_profile"), requestKey: uuid, expectedRevision: z.string().min(1).max(80), profile: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length === profileKeys.length && profileKeys.every(key => Object.hasOwn(value, key)), "Review the complete business settings.").pipe(PROFILE_SCHEMA) }).strict();
export class BusinessProfileSaveError extends Error {
  readonly status: 403 | 409 | 422 | 503;
  constructor(status: 403 | 409 | 422 | 503, message: string) { super(message); this.name = "BusinessProfileSaveError"; this.status = status; }
}
const commandSchema = z.discriminatedUnion("action", [
  SaveBusinessProfileCommandSchema,
  z.object({
    action: z.literal("save_record"),
    record: RECORD_SCHEMA,
    id: uuid.optional(),
    revision: z.number().int().positive().optional(),
    requestKey: uuid,
  }),
  z.object({
    action: z.literal("transition"),
    id: uuid,
    revision: z.number().int().positive(),
    transition: z.enum([
      "submit",
      "approve",
      "reject",
      "start",
      "block",
      "complete",
      "order",
      "receive",
      "publish",
      "pay",
      "archive",
    ]),
    reference: z.string().max(2000).default(""),
  }),
  z.object({
    action: z.literal("install"),
    recipeKey: z.string().max(100),
    enabled: z.boolean(),
    schedule: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("run"),
    recipeKey: z.string().max(100),
    brief: z.string().max(10000).default(""),
    sourceId: uuid.optional(),
    requestKey: uuid,
  }),
  z.object({
    action: z.literal("purchase_opportunity"),
    id: uuid,
    requestKey: uuid,
  }),
  z.object({
    action: z.literal("add_contact"),
    name: z.string().trim().min(2).max(180),
    email: z.union([z.literal(""), z.email()]),
    phone: z.string().trim().max(40),
  }),
]);
export async function mutateBusinessWorkspace(
  admin: SupabaseClient,
  portal: Extract<ClientPortal, { kind: "ok" }>,
  input: unknown,
): Promise<MutationResult> {
  const profileSave = input !== null && typeof input === "object" && "action" in input && input.action === "save_profile";
  if (!canWriteBusinessWorkspace(portal.access))
    throw profileSave ? new BusinessProfileSaveError(403, "You do not have permission to change these business settings.") : new Error("You do not have permission to change this workspace.");
  if (profileSave && !SaveBusinessProfileCommandSchema.safeParse(input).success) throw new BusinessProfileSaveError(422, "Reload the current settings and check the complete profile before saving.");
  const command = commandSchema.parse(input);
  const scope = {
    partnerId: portal.client.partner_id,
    clientId: portal.client.id,
    actorId: portal.user.id,
  };
  if (command.action === "save_profile") {
    try {
      const result = await admin.rpc("save_business_profile", { p_partner: scope.partnerId, p_client: scope.clientId, p_actor: scope.actorId, p_key: command.requestKey, p_revision: command.expectedRevision, p_profile: command.profile });
      if (result.error) {
        const code = result.error.code;
        if (code === "PT409") throw new BusinessProfileSaveError(409, "Business facts changed elsewhere. Reload saved settings before saving again.");
        if (code === "42501") throw new BusinessProfileSaveError(403, "You do not have permission to change these business settings.");
        if (code === "22023") throw new BusinessProfileSaveError(422, "Check the complete business settings before saving.");
        throw new BusinessProfileSaveError(503, "The save could not be confirmed. Retry the same change or reload saved settings.");
      }
      const receipt = parseBusinessProfileSaveReceipt(result.data, command.requestKey);
      if (!receipt) throw new BusinessProfileSaveError(503, "The saved receipt could not be confirmed. Retry the same change or reload saved settings.");
      return { ok: true, profileReceipt: receipt, message: receipt.replayed ? "The original business settings save was confirmed. Current facts are shown." : "Business settings and assistant knowledge saved together." };
    } catch (error) { if (error instanceof BusinessProfileSaveError) throw error; throw new BusinessProfileSaveError(503, "The save could not be confirmed. Retry the same change or reload saved settings."); }
  }
  if (command.action === "save_record") {
    if (command.id) {
      if (!command.revision)
        throw new Error("The current record revision is required.");
      const current = await admin
        .from("business_records")
        .select("kind")
        .eq("id", command.id)
        .eq("client_id", scope.clientId)
        .eq("partner_id", scope.partnerId)
        .maybeSingle();
      if (current.error || current.data?.kind !== command.record.kind)
        throw new Error("The record could not be found.");
      await validateGoalLink(admin, scope, command.record);
      if (
        command.record.kind === "purchase" &&
        command.record.data.product_id
      ) {
        const linked = await admin
          .from("business_records")
          .select("id")
          .eq("id", command.record.data.product_id)
          .eq("client_id", scope.clientId)
          .eq("partner_id", scope.partnerId)
          .eq("kind", "product")
          .maybeSingle();
        if (linked.error || !linked.data)
          throw new Error("Choose inventory from this business.");
      }
      const { error } = await admin.rpc("edit_business_record", {
        p_partner: scope.partnerId,
        p_client: scope.clientId,
        p_actor: scope.actorId,
        p_id: command.id,
        p_revision: command.revision,
        p_title: command.record.title,
        p_body: command.record.body,
        p_data: command.record.data,
      });
      if (error)
        throw new Error(
          error.message.includes("Record changed")
            ? "This record changed. Refresh and review before editing."
            : "Only draft or declined records can be edited. Refresh to see the current state.",
        );
      return { ok: true, message: "Changes saved.", recordId: command.id };
    }
    const recordId = await createBusinessRecord(
      admin,
      scope,
      command.record,
      command.requestKey,
    );
    return { ok: true, message: "Record saved.", recordId };
  }
  if (command.action === "transition") {
    const { error } = await admin.rpc("transition_business_record", {
      p_partner: scope.partnerId,
      p_client: scope.clientId,
      p_actor: scope.actorId,
      p_id: command.id,
      p_revision: command.revision,
      p_action: command.transition,
      p_reference: command.reference,
    });
    if (error)
      throw new Error(
        error.message.includes("Record changed")
          ? "This record changed. Refresh and review the latest version."
          : error.message.includes("reference")
            ? "Add a reference confirming the external action."
            : "That change is unavailable for the current record state. Refresh and try again.",
      );
    return {
      ok: true,
      message:
        command.transition === "approve"
          ? "Approved. External ordering and publishing still require a supported connection or a recorded manual action."
          : "Record updated.",
      recordId: command.id,
    };
  }
  if (command.action === "install") {
    const recipe = BUSINESS_RECIPES.find((r) => r.key === command.recipeKey);
    if (!recipe) throw new Error("Unknown capability.");
    if (recipe.mode === "connection")
      throw new Error(
        "Use connected-app setup to activate and test this capability.",
      );
    if (command.schedule && !recipe.schedule)
      throw new Error("This capability needs a brief for each run.");
    const { error } = await admin.from("business_capability_installs").upsert(
      {
        partner_id: scope.partnerId,
        client_id: scope.clientId,
        recipe_key: recipe.key,
        status: command.enabled ? "enabled" : "paused",
        schedule_enabled: command.enabled && command.schedule,
        next_run_at:
          command.enabled && command.schedule
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,recipe_key" },
    );
    if (error) throw new Error("The capability could not be updated.");
    return {
      ok: true,
      message: command.enabled
        ? `${recipe.name} enabled${command.schedule ? " with a daily schedule. Background processing must be running" : ""}.`
        : `${recipe.name} paused.`,
    };
  }
  if (command.action === "run")
    return {
      ok: true,
      ...(await runBusinessRecipe(
        admin,
        scope,
        command.recipeKey,
        command.brief,
        command.requestKey,
        command.sourceId,
      )),
    };
  if (command.action === "purchase_opportunity") {
    const { data: source, error } = await admin
      .from("business_records")
      .select("*")
      .eq("id", command.id)
      .eq("client_id", scope.clientId)
      .eq("partner_id", scope.partnerId)
      .eq("kind", "opportunity")
      .neq("status", "archived")
      .maybeSingle();
    if (error || !source) throw new Error("The opportunity is unavailable.");
    const recordId = await createBusinessRecord(
      admin,
      scope,
      {
        kind: "purchase",
        title: `Purchase ${source.title}`.slice(0, 180),
        body: `Prepared from sourcing opportunity.\nSource: ${source.data.url || "Not provided"}\n${source.body}\n\nConfirm availability, fees, and supplier details before approving.`,
        data: {
          supplier: String(source.data.supplier ?? ""),
          quantity: 1,
          unit_cost: Number(source.data.cost) + Number(source.data.fees || 0),
          shipping: Number(source.data.shipping || 0),
          product_id: "",
          order_reference: "",
        },
      },
      `source-purchase:${source.id}:${source.revision}`,
      source.id,
    );
    return {
      ok: true,
      message: "Purchase request prepared. Review it in Purchasing.",
      recordId,
    };
  }
  const name = command.name.split(/\s+/);
  const email = command.email.toLowerCase();
  if (!email && !command.phone)
    throw new Error("Add an email address or phone number.");
  if (email) {
    const { data, error } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", scope.clientId)
      .eq("partner_id", scope.partnerId)
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Customer records are unavailable.");
    if (data)
      return {
        ok: true,
        message: "A customer with this email already exists.",
      };
  }
  const { error } = await admin.from("crm_contacts").insert({
    partner_id: scope.partnerId,
    client_id: scope.clientId,
    first_name: name[0],
    last_name: name.slice(1).join(" ") || null,
    email: email || null,
    phone: command.phone || null,
    source: "business_workspace",
  });
  if (error) throw new Error("The customer could not be saved.");
  return { ok: true, message: "Customer saved to your shared records." };
}
