import type { SupabaseClient } from "@supabase/supabase-js";
import { googleAccountCanAct } from "../connections/google-permissions.ts";
import {
  AUTHORITY_CHANNELS,
  AUTHORITY_MODES,
  type AuthorityChannel,
  type AuthorityMode,
  type BusinessAuthority,
} from "../business/context-contract.ts";

export type AuthoritySettings = {
  status: string;
  authority_revision?: number;
  channel_authority?: Partial<Record<AuthorityChannel, AuthorityMode>> | null;
  conversations_enabled?: boolean;
  sales_enabled?: boolean;
  scheduling_enabled?: boolean;
  context_reviewed?: boolean;
};
export type AuthorityActivation = {
  status: string;
  website?: boolean;
  email?: boolean;
  sms?: boolean;
  instagram?: boolean;
  bookings?: boolean;
  workspace_connection_id?: string | null;
};
export type AuthorityConnection = {
  id: string;
  status: string;
  runtime_mode: string;
  config?: Record<string, unknown> | null;
  provider_key?: string;
};
const PROVIDERS: Record<AuthorityChannel, string[]> = {
  website: ["northstar_web_chat"],
  email: ["google_workspace", "microsoft_365", "resend"],
  sms: ["twilio"],
  instagram: ["instagram_messaging"],
  calendar: ["google_workspace", "microsoft_365", "google_calendar", "northstar_internal"],
};
export function authorityChannel(value: unknown): AuthorityChannel | null {
  if (value === "website_chat") return "website";
  return AUTHORITY_CHANNELS.includes(value as AuthorityChannel) ? value as AuthorityChannel : null;
}
/** Import access stays read-only; an explicitly verified Google permission is
 * an exception only for its exact supported action channel. */
export function accountIsReadOnlyFor(connection: AuthorityConnection, channel: AuthorityChannel, activation?: AuthorityActivation | null): boolean {
  return connection.config?.workspace_view_only === true &&
    !(connection.provider_key === "google_workspace" && (channel === "calendar" || channel === "email") && googleAccountCanAct(connection.config, channel) && activation?.status === "active" && activation.workspace_connection_id === connection.id && (channel === "calendar" ? activation.bookings : activation.email));
}
const cap = (mode: AuthorityMode, maximum: AuthorityMode): AuthorityMode =>
  AUTHORITY_MODES[Math.min(AUTHORITY_MODES.indexOf(mode), AUTHORITY_MODES.indexOf(maximum))];

/** A review covers the current profile only while supplied knowledge agrees. */
export function contextReviewIsCurrent(
  profileRevision: string | null,
  reviewedRevision: string | null,
  profile: Record<string, unknown> | null,
  knowledge: Record<string, unknown> | null,
): boolean {
  if (!profile || !profileRevision || profileRevision !== reviewedRevision) return false;
  const pairs = [
    ["description", "business_description"], ["services", "services_offered"],
    ["hours", "business_hours"], ["policies", "booking_rules"],
  ];
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  return !pairs.some(([fact, known]) => text(profile[fact]) && text(knowledge?.[known]) &&
    text(profile[fact]) !== text(knowledge?.[known]));
}

async function readContextReview(admin: SupabaseClient, scope: { partnerId: string; clientId: string }) {
  const [profile, review, knowledge] = await Promise.all([
    admin.from("business_workspace_profiles").select("updated_at,profile")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("business_context_reviews").select("profile_revision")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("client_knowledge_profiles").select("business_description,services_offered,business_hours,booking_rules")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
  ]);
  if (profile.error || review.error || knowledge.error) throw new Error("Current business context review could not be verified.");
  return contextReviewIsCurrent(profile.data?.updated_at ?? null, review.data?.profile_revision ?? null,
    profile.data?.profile ?? null, knowledge.data);
}

/** Existing activation choices and provider permissions remain upper bounds. */
export function effectiveAuthoritySnapshot(
  settings: AuthoritySettings | null,
  activation: AuthorityActivation | null,
  connections: AuthorityConnection[],
  options: { internalCalendarEnabled?: boolean } = {},
): BusinessAuthority {
  const channels = {} as BusinessAuthority["channels"];
  for (const channel of AUTHORITY_CHANNELS) {
    const selected = channel === "calendar" ? activation?.bookings : activation?.[channel];
    const explicit = settings?.channel_authority?.[channel];
    let mode: AuthorityMode = explicit && AUTHORITY_MODES.includes(explicit)
      ? explicit : activation?.status === "active" && selected ? "require_approval" : "off";
    if (settings?.status !== "active") mode = cap(mode, "observe");
    if (settings?.context_reviewed === false) mode = cap(mode, "observe");
    if (channel === "calendar" ? !settings?.scheduling_enabled : !settings?.conversations_enabled && !settings?.sales_enabled)
      mode = cap(mode, "observe");
    if (!activation || activation.status !== "active" || !selected) mode = cap(mode, "draft");
    const accounts = connections.filter((c) => PROVIDERS[channel].includes(c.provider_key ?? ""));
    const internalCalendar = channel === "calendar" && options.internalCalendarEnabled;
    if (!internalCalendar && !accounts.some((c) => c.status === "connected" && c.runtime_mode === "live")) mode = cap(mode, "draft");
    if (!internalCalendar && accounts.length && accounts.every((c) => accountIsReadOnlyFor(c, channel, activation))) mode = cap(mode, "observe");
    channels[channel] = mode;
  }
  return { revision: settings?.authority_revision ?? 0, status: settings?.status === "active" ? "active" : "paused", channels };
}

export function internalCalendarEnabled(client: {
  status: string; crm_operating_mode: string; default_runtime_mode: string;
} | null): boolean {
  return client?.status === "active" &&
    ["primary_crm", "mirror", "assist"].includes(client.crm_operating_mode) &&
    client.default_runtime_mode === "live";
}

export function evaluateInternalBookingAuthority(input: {
  settings: AuthoritySettings | null;
  activation: AuthorityActivation | null;
  client: { status: string; crm_operating_mode: string; default_runtime_mode: string } | null;
  approved: boolean;
  expectedRevision?: number;
}) {
  const enabled = internalCalendarEnabled(input.client);
  const authority = effectiveAuthoritySnapshot(input.settings, input.activation, [], { internalCalendarEnabled: enabled });
  const check = evaluateAuthority({ authority, channel: "calendar", phase: "draft", expectedRevision: input.expectedRevision });
  if (!check.allowed) return check;
  if (!enabled || !input.approved || input.activation?.status !== "active" ||
      !input.activation.bookings || authority.channels.calendar !== "require_approval")
    return { allowed: false, reason: "An active internal calendar, selected booking capability and human approval are required.", revision: authority.revision };
  return { allowed: true, reason: "Current owner authority permits the approved internal booking.", revision: authority.revision };
}

/** Internal calendar is an actual application capability, never a fake account. */
export async function readInternalBookingAuthority(
  admin: SupabaseClient,
  scope: { partnerId: string; clientId: string },
  options: { approvalId: string; expectedRevision?: number; now?: Date },
) {
  const [settings, activation, client, approval, contextReviewed] = await Promise.all([
    admin.from("agent_team_settings").select("status,authority_revision,channel_authority,scheduling_enabled")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("business_agent_activation").select("status,bookings")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("client_businesses").select("status,crm_operating_mode,default_runtime_mode")
      .eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle(),
    admin.from("approval_items").select("status,type,proposed_payload,expires_at")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("id", options.approvalId).maybeSingle(),
    readContextReview(admin, scope),
  ]);
  if (settings.error || activation.error || client.error || approval.error)
    throw new Error("Current internal booking authority could not be verified.");
  const approved = !!approval.data && approval.data.type === "appointment_booking" &&
    ["approved", "edited_and_approved"].includes(approval.data.status) &&
    approval.data.proposed_payload?.provider === "northstar_internal" &&
    approval.data.proposed_payload?.scenario_lab !== true &&
    (!approval.data.expires_at || Date.parse(approval.data.expires_at) > (options.now?.getTime() ?? Date.now()));
  return evaluateInternalBookingAuthority({
    settings: settings.data ? { ...settings.data, context_reviewed: contextReviewed } : null,
    activation: activation.data, client: client.data,
    approved, expectedRevision: options.expectedRevision,
  });
}

export function evaluateAuthority(input: {
  authority: BusinessAuthority;
  channel: AuthorityChannel;
  phase: "observe" | "draft" | "execute";
  expectedRevision?: number;
  approved?: boolean;
  connection?: AuthorityConnection | null;
  activation?: AuthorityActivation | null;
}): { allowed: boolean; reason: string; revision: number } {
  const reject = (reason: string) => ({ allowed: false, reason, revision: input.authority.revision });
  if (input.expectedRevision !== undefined && input.expectedRevision !== input.authority.revision)
    return reject("Owner authority changed. Prepare and review a fresh action.");
  const mode = input.authority.channels[input.channel];
  if (mode === "off") return reject("The owner stopped this channel. Nothing was sent.");
  if (input.phase !== "observe" && input.authority.status !== "active") return reject("The team is paused.");
  if (input.phase !== "observe" && input.connection && accountIsReadOnlyFor(input.connection, input.channel, input.activation))
    return reject("This account is read only. Reauthorization is required for agent work.");
  if (input.phase === "draft" && !["draft", "require_approval"].includes(mode))
    return reject("This channel is limited to observation.");
  if (input.phase === "execute") {
    if (mode !== "require_approval" || !input.approved) return reject("This channel does not authorize approved external actions.");
    if (!input.connection || input.connection.status !== "connected" || input.connection.runtime_mode !== "live")
      return reject("This account is unavailable or is not live.");
    if (accountIsReadOnlyFor(input.connection, input.channel, input.activation))
      return reject("This account is read only. Reauthorization is required for external actions.");
    if (input.connection.config?.workspace_view_only === true) {
      const verified = input.channel === "calendar" ? input.connection.config.activation_calendar_verified : input.connection.config.activation_mail_verified;
      const checked = Date.parse(String(input.connection.config.activation_checked_at ?? ""));
      if (verified !== true || !Number.isFinite(checked) || checked > Date.now() + 60_000 || Date.now() - checked > 24 * 60 * 60_000)
        return reject("Recheck the selected Google account permission before this approved action.");
    }
  }
  return { allowed: true, reason: "Current owner authority permits this step.", revision: input.authority.revision };
}

export async function readEffectiveAuthority(
  admin: SupabaseClient,
  scope: { partnerId: string; clientId: string },
  channel: AuthorityChannel,
  options: { phase: "observe" | "draft" | "execute"; connectionId?: string | null; expectedRevision?: number; approved?: boolean; internalCalendar?: boolean },
) {
  const [settings, activation, accounts, contextReviewed, internalClient] = await Promise.all([
    admin.from("agent_team_settings").select("status,authority_revision,channel_authority,conversations_enabled,sales_enabled,scheduling_enabled")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("business_agent_activation").select("status,website,email,sms,instagram,bookings,workspace_connection_id")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(),
    admin.from("integration_connections").select("id,status,runtime_mode,config,provider:integration_providers!inner(provider_key)")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId),
    readContextReview(admin, scope),
    options.internalCalendar && channel === "calendar" && options.phase === "draft"
      ? admin.from("client_businesses").select("status,crm_operating_mode,default_runtime_mode")
        .eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (settings.error || activation.error || accounts.error || internalClient.error) throw new Error("Current owner authority could not be verified.");
  const connections: AuthorityConnection[] = (accounts.data ?? []).map((row) => ({
    ...row, provider_key: (row.provider as unknown as { provider_key: string })?.provider_key,
  }));
  const candidates = connections.filter((c) => PROVIDERS[channel].includes(c.provider_key ?? ""));
  // Explicit account bindings must never silently fall back to another account.
  const selectedId = activation.data?.status === "active" && ((channel === "email" && activation.data.email) || (channel === "calendar" && activation.data.bookings))
    ? activation.data.workspace_connection_id : null;
  const eligible = candidates.filter((c) => c.status === "connected" && c.runtime_mode === "live" && !accountIsReadOnlyFor(c, channel, activation.data));
  const connection = options.connectionId ? candidates.find((c) => c.id === options.connectionId)
    : selectedId ? candidates.find((c) => c.id === selectedId) : eligible.length === 1 ? eligible[0] : undefined;
  return { ...evaluateAuthority({
    authority: effectiveAuthoritySnapshot(settings.data ? { ...settings.data, context_reviewed: contextReviewed } : null, activation.data, connections,
      { internalCalendarEnabled: internalCalendarEnabled(internalClient.data) }),
    channel, ...options, connection, activation: activation.data,
  }), connectionId: connection?.id ?? null };
}
