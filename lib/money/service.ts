import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEffectiveAuthority } from "../agents/authority.ts";
import { safeProviderLink } from "../connections/record-mapper.ts";
import { formatMinorMoney, knownCurrency, minorAmount } from "../connections/money.ts";
import { readInvoiceFollowupPin, invoiceFollowupEligibilityBlock } from "./eligibility.ts";
import type { InvoiceFollowupCommand, InvoiceFollowupPin, InvoiceFollowupReceipt, InvoiceFollowupReview } from "./contract.ts";

type Scope = { partnerId: string; clientId: string };
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value; }
export const invoiceReviewRevision = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
export class InvoiceFollowupError extends Error { readonly status: number; constructor(message: string, status = 409) { super(message); this.status = status; } }
const Query = z.object({ connectionId: z.uuid(), recordId: z.uuid() }).strict();
const Command = z.object({ action: z.enum(["prepare_invoice_followup", "handoff_invoice_followup"]), key: z.uuid(), targetId: z.uuid(), connectionId: z.uuid(), expectedRevision: z.string().min(1).max(1500), recipientConversationId: z.uuid().optional(), expectedRecipientRevision: z.string().min(1).max(1500).optional(), identityConfirmed: z.literal(true).optional(), outreachPermissionConfirmed: z.literal(true).optional(), note: z.string().trim().max(2000).optional() }).strict();

async function loadSource(admin: SupabaseClient, scope: Scope, input: { connectionId: string; recordId: string }) {
  const scoped = <C extends string>(table: string, columns: C) => admin.from(table).select(columns).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  const [sourceResult, accountResult, settingsResult] = await Promise.all([
    scoped("integration_canonical_records", "id,connection_id,external_object_id,canonical_data,updated_at,external_updated_at,snapshot_observed_at").eq("id", input.recordId).eq("connection_id", input.connectionId).eq("object_type", "invoice").maybeSingle(),
    scoped("integration_connections", "id,display_name,external_account_name,external_account_id,status,runtime_mode,config,updated_at,provider:integration_providers!inner(provider_key)").eq("id", input.connectionId).maybeSingle(),
    scoped("agent_team_settings", "authority_revision,channel_authority").maybeSingle(),
  ]);
  if ([sourceResult, accountResult, settingsResult].some((r) => r.error)) throw new InvoiceFollowupError("Current invoice evidence could not be checked. Retry before deciding.", 503);
  const source = sourceResult.data, account = accountResult.data;
  if (!source || !account || (account.provider as unknown as { provider_key: string })?.provider_key !== "stripe") throw new InvoiceFollowupError("The exact Stripe invoice is unavailable.", 404);
  const [check, proposals, task, business] = await Promise.all([
    admin.rpc("invoice_followup_source_check", { p_partner: scope.partnerId, p_client: scope.clientId, p_source: source.id, p_connection: account.id }),
    account.external_account_id ? scoped("approval_items", "id,status,proposed_payload,created_at,expires_at").eq("proposed_payload->>invoice_followup_version", "1").eq("proposed_payload->>stripe_account_id", account.external_account_id).eq("proposed_payload->>invoice_id", source.external_object_id).order("created_at", { ascending: false }).limit(51) : Promise.resolve({ data: [], error: null }),
    scoped("crm_tasks", "id,status").eq("source_invoice_record_id", source.id).maybeSingle(),
    admin.from("client_businesses").select("name").eq("id", scope.clientId).eq("partner_id", scope.partnerId).maybeSingle(),
  ]);
  if ([check, proposals, task, business].some((r) => r.error)) throw new InvoiceFollowupError("Invoice policy or saved outcomes could not be checked.", 503);
  const ids = (proposals.data ?? []).map((a) => a.id);
  const jobs = ids.length ? await scoped("action_jobs", "id,approval_id,status,external_ref").in("approval_id", ids).order("created_at", { ascending: false }).limit(101) : { data: [], error: null };
  if (jobs.error || (proposals.data?.length ?? 0) > 50 || (jobs.data?.length ?? 0) > 100) throw new InvoiceFollowupError("Invoice follow-up history coverage is incomplete. Review Action history.", 409);
  const existingApproval = (proposals.data ?? []).find((a) => !["rejected", "expired"].includes(a.status) || jobs.data?.some((j) => j.approval_id === a.id && (["processing", "provider_pending", "uncertain", "succeeded", "failed", "pending"].includes(j.status) || !!j.external_ref)));
  const outcome = existingApproval ? jobs.data?.find((j) => j.approval_id === existingApproval.id) : null;
  const existing: InvoiceFollowupReview["existing"] = existingApproval ? { approvalId: existingApproval.id, taskId: task.data?.id ?? null, status: outcome?.status ?? existingApproval.status, detail: outcome ? `Existing reminder outcome: ${outcome.status.replaceAll("_", " ")}. Check Approvals and Action history; this review will not repeat it.` : "An invoice reminder is already prepared. Review its existing approval." } : task.data ? { approvalId: null, taskId: task.data.id, status: task.data.status, detail: "A source-linked invoice review task is already saved." } : null;
  const revision = invoiceReviewRevision({ source, account, settings: settingsResult.data, proposals: proposals.data, jobs: jobs.data, task: task.data });
  return { source, account, settings: settingsResult.data, facts: object(source.canonical_data), check: object(check.data), existing, revision, businessName: business.data?.name || "the business" };
}

async function loadRecipients(admin: SupabaseClient, scope: Scope, canWrite: boolean, settings: { authority_revision: number; channel_authority: unknown } | null) {
  if (!canWrite || object(settings?.channel_authority).email !== "require_approval") return { choices: [], rows: new Map<string, { thread: Row; contact: Row; connection: Row }>(), complete: true };
  const threads = await admin.from("business_conversations").select("id,contact_id,connection_id,external_thread_id,revision,mode,state,opted_out,identity_status")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("channel", "email").eq("identity_status", "owner_verified").eq("mode", "agent").eq("opted_out", false).neq("state", "closed").order("id").limit(51);
  if (threads.error) throw new InvoiceFollowupError("Verified customer conversation choices could not be checked.", 503);
  const list = threads.data ?? [], contactIds = [...new Set(list.map((c) => c.contact_id).filter((id): id is string => !!id))], connectionIds = [...new Set(list.map((c) => c.connection_id))];
  const [contacts, connections] = await Promise.all([
    contactIds.length ? admin.from("crm_contacts").select("id,first_name,last_name,updated_at,tags").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("id", contactIds) : Promise.resolve({ data: [], error: null }),
    connectionIds.length ? admin.from("integration_connections").select("id,display_name,external_account_name,status,runtime_mode,updated_at").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("id", connectionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error || connections.error) throw new InvoiceFollowupError("Current recipient identities and accounts could not be checked.", 503);
  const authority = new Map<string, boolean>();
  for (const id of connectionIds) authority.set(id, (await readEffectiveAuthority(admin, scope, "email", { phase: "execute", approved: true, connectionId: id, expectedRevision: settings?.authority_revision })).allowed);
  const rows = new Map<string, { thread: Row; contact: Row; connection: Row }>();
  const choices = list.slice(0, 50).flatMap((thread) => {
    const contact = contacts.data?.find((c) => c.id === thread.contact_id), connection = connections.data?.find((c) => c.id === thread.connection_id);
    if (!contact || !connection || !authority.get(connection.id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(thread.external_thread_id) || contact.tags?.some((tag: string) => ["do_not_contact", "opt_out", "opted_out", "unsubscribed", "stop"].includes(tag.trim().toLowerCase().replace(/[ -]+/g, "_")))) return [];
    rows.set(thread.id, { thread, contact, connection });
    return [{ conversationId: thread.id, contactId: contact.id, name: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Verified customer", email: thread.external_thread_id, account: connection.external_account_name || connection.display_name, revision: invoiceReviewRevision({ thread, contact, connection, authority: settings?.authority_revision }) }];
  });
  return { choices, rows, complete: list.length <= 50 };
}

export async function readInvoiceFollowupReview(admin: SupabaseClient, scope: Scope, canWrite: boolean, raw: unknown): Promise<InvoiceFollowupReview> {
  const input = Query.parse(raw), current = await loadSource(admin, scope, input), recipient = await loadRecipients(admin, scope, canWrite, current.settings);
  const f = current.facts;
  const domainBlock = invoiceFollowupEligibilityBlock(f, new Date().toISOString());
  return { version: 1, canWrite, eligible: !domainBlock && current.check.allowed === true && !current.existing?.approvalId, blockReason: domainBlock || (current.check.allowed !== true ? text(current.check.reason) : current.existing?.approvalId ? current.existing.detail : null),
    invoice: { id: current.source.id, connectionId: current.account.id, externalId: current.source.external_object_id, revision: current.revision, account: current.account.external_account_name || current.account.display_name,
      number: text(f.number) || null, status: text(f.status) || "unknown", currency: knownCurrency(f.currency), amountDueMinor: minorAmount(f.amount_due_minor), totalMinor: minorAmount(f.total_minor), dueAt: text(f.due_date) || null,
      href: safeProviderLink(f.hosted_url, "stripe", "invoice"), observedAt: current.source.snapshot_observed_at }, recipients: recipient.choices, recipientCoverageComplete: recipient.complete, existing: current.existing };
}

export async function executeInvoiceFollowupCommand(admin: SupabaseClient, actor: Scope & { actorId: string }, raw: unknown): Promise<InvoiceFollowupReceipt> {
  const parsed = Command.safeParse(raw);
  if (!parsed.success) throw new InvoiceFollowupError("Review the current invoice and choose a supported decision.", 400);
  const command: InvoiceFollowupCommand = parsed.data;
  const prior = await admin.from("business_owner_commands").select("actor_id,command,result").eq("partner_id", actor.partnerId).eq("client_id", actor.clientId).eq("request_key", command.key).maybeSingle();
  if (prior.error) throw new InvoiceFollowupError("The saved invoice decision could not be checked. Retry unchanged.", 503);
  if (prior.data) {
    if (prior.data.actor_id !== actor.actorId || invoiceReviewRevision(object(prior.data.command).owner_request) !== invoiceReviewRevision(command)) throw new InvoiceFollowupError("This key belongs to a different invoice decision.");
    return readReceipt({ ...object(prior.data.result), replayed: true }, command.targetId);
  }
  const current = await loadSource(admin, actor, { recordId: command.targetId, connectionId: command.connectionId });
  if (current.revision !== command.expectedRevision) throw new InvoiceFollowupError("The invoice, source or saved work changed. Refresh and review again.");
  let normalized: Row;
  if (command.action === "handoff_invoice_followup") {
    if (command.recipientConversationId || command.expectedRecipientRevision || command.identityConfirmed || command.outreachPermissionConfirmed) throw new InvoiceFollowupError("A source-app handoff does not select or authorize a recipient.", 400);
    normalized = { owner_request: command, expectedSourceUpdatedAt: current.source.updated_at };
  } else {
    if (!command.identityConfirmed || !command.outreachPermissionConfirmed || !command.recipientConversationId || !command.expectedRecipientRevision || command.note) throw new InvoiceFollowupError("Explicitly verify the chosen customer and permission to contact them about this invoice.", 400);
    if (current.check.allowed !== true || current.existing?.approvalId) throw new InvoiceFollowupError(text(current.check.reason) || "Review the existing reminder before preparing another.");
    const recipients = await loadRecipients(admin, actor, true, current.settings), recipient = recipients.choices.find((r) => r.conversationId === command.recipientConversationId);
    const selected = recipients.rows.get(command.recipientConversationId);
    if (!recipient || !selected || recipient.revision !== command.expectedRecipientRevision) throw new InvoiceFollowupError("The verified customer conversation or selected email authority changed. Refresh and review.");
    const activity = await admin.rpc("calendar_mutation_latest_activity", { p_partner: actor.partnerId, p_client: actor.clientId, p_contact: recipient.contactId });
    if (activity.error) throw new InvoiceFollowupError("Current customer instructions could not be pinned.", 503);
    const f = current.facts, a = object(activity.data);
    const pin: InvoiceFollowupPin = { invoice_followup_version: 1, money_review_id: randomUUID(), source_record_id: current.source.id, source_updated_at: current.source.updated_at,
      source_external_updated_at: current.source.external_updated_at, stripe_connection_id: current.account.id, stripe_account_id: text(current.account.external_account_id), invoice_id: current.source.external_object_id,
      stripe_customer_id: text(f.customer_id), amount_due_minor: Number(f.amount_due_minor), amount_paid_minor: Number(f.amount_paid_minor), total_minor: Number(f.total_minor), currency: text(f.currency), due_at: text(f.due_date), collection_method: "send_invoice", hosted_invoice_url: text(f.hosted_url) || null, invoice_number: text(f.number) || null,
      contact_id: recipient.contactId, contact_updated_at: text(selected.contact.updated_at), channel: "email", to: recipient.email, connection_id: text(selected.connection.id), authority_revision: current.settings?.authority_revision ?? -1,
      conversation_id: recipient.conversationId, conversation_revision: Number(selected.thread.revision), customer_activity_id: text(a.id) || null, customer_activity_at: text(a.at) || null };
    if (!readInvoiceFollowupPin(pin)) throw new InvoiceFollowupError("The exact invoice or verified recipient needs source review before preparing a reminder.");
    const amount = formatMinorMoney(pin.amount_due_minor, pin.currency);
    if (!amount) throw new InvoiceFollowupError("The invoice currency or amount cannot be represented safely.");
    const label = pin.invoice_number || pin.invoice_id, link = safeProviderLink(pin.hosted_invoice_url, "stripe", "invoice");
    const body = `Hello ${recipient.name},\n\nOur current invoice record shows ${amount} remaining on invoice ${label}, due ${pin.due_at.slice(0, 10)}.${link ? ` You can review the invoice at ${link}` : ""}\n\nIf you have already paid or have a question, please reply so we can check the source record.\n\nThank you,\n${current.businessName}`;
    normalized = { owner_request: command, pin, body, subject: `Invoice ${label} — payment follow-up`.slice(0, 300) };
  }
  const result = await admin.rpc("prepare_invoice_followup", { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: normalized });
  if (result.error) throw new InvoiceFollowupError(["40001", "22023", "23505"].includes(result.error.code) ? "The invoice, recipient or permission changed or already has work. Refresh and review its saved outcome." : "The invoice decision could not be confirmed. Retry this unchanged request.", ["40001", "22023", "23505"].includes(result.error.code) ? 409 : 503);
  return readReceipt(result.data, command.targetId);
}
function readReceipt(raw: unknown, target: string): InvoiceFollowupReceipt {
  const parsed = z.object({ id: z.uuid(), sourceRecordId: z.uuid(), taskId: z.uuid(), approvalId: z.uuid().nullable(), replayed: z.boolean(), message: z.string().min(1) }).safeParse(raw);
  if (!parsed.success || parsed.data.sourceRecordId !== target) throw new InvoiceFollowupError("The server did not confirm the exact saved invoice decision. Retry unchanged.", 503);
  return parsed.data;
}
