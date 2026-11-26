import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentScope } from "@/lib/agents/types";
import { readActivationPlan } from "@/lib/activation/service";
import { slotFitsActivation } from "@/lib/activation/rules";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  getBusyIntervals,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import { getGoogleWorkspaceBusyIntervals } from "@/lib/integrations/providers/google-workspace";
import { getMicrosoftBusyIntervals } from "@/lib/integrations/providers/microsoft-365";
import type { WorkspaceCredentials } from "@/lib/integrations/providers/workspace-oauth";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import {
  EXTERNAL_CALENDAR_PROVIDER_KEYS,
  resolveSchedulingProvider,
  type ExternalCalendarProvider,
} from "@/lib/scheduling/provider";
import {
  computeOpenSlots,
  formatSlotLabel,
  type AvailabilityWindow,
} from "@/lib/scheduling/slots";
import { parseSchedulingConstraints } from "@/lib/scheduling/constraints";
import { internalCalendarEnabled } from "@/lib/agents/authority";
import { reviewedInternalAvailabilityWindows } from "@/lib/connections/intake-progression";
export type OfferedSlot = { start_iso: string; end_iso: string; label: string };
export async function availableSlots(
  admin: SupabaseClient,
  scope: AgentScope,
  preference: string,
) {
  const activation = await readActivationPlan(admin, scope);
  if (
    activation &&
    (!activation.bookings ||
      activation.status !== "active")
  )
    throw new Error("Connect and enable your selected booking calendar first.");
  let calendarQuery = admin
    .from("integration_connections")
    .select(
      "id,runtime_mode,provider:integration_providers!inner(provider_key)",
    )
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .in("status", ["connected", "needs_attention"])
    .in("provider.provider_key", [...EXTERNAL_CALENDAR_PROVIDER_KEYS]);
  if (activation?.workspace_connection_id)
    calendarQuery = calendarQuery
      .eq("id", activation.workspace_connection_id)
      .eq("runtime_mode", "live")
      .eq("status", "connected");
  const [source, business, knowledge] = await Promise.all([
    activation && !activation.workspace_connection_id
      ? Promise.resolve({ data: null, error: null })
      : calendarQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("client_businesses")
      .select("timezone,crm_operating_mode,status,default_runtime_mode")
      .eq("id", scope.clientId)
      .eq("partner_id", scope.partnerId)
      .single(),
    getKnowledgeProfile(admin, scope.clientId),
  ]);
  if (source.error || business.error)
    throw new Error("Calendar configuration is unavailable.");
  if (activation?.workspace_connection_id && !source.data)
    throw new Error("Your selected calendar needs reconnection.");
  const provider = resolveSchedulingProvider({
    hasGoogleCalendar: !!source.data,
    externalProvider: (
      source.data?.provider as unknown as {
        provider_key: ExternalCalendarProvider;
      }
    )?.provider_key,
    crmOperatingMode: business.data.crm_operating_mode,
  });
  if (!provider)
    throw new Error(
      "Connect a calendar or enable the built-in calendar before offering appointments.",
    );
  if (activation && provider === "northstar_internal" && !internalCalendarEnabled(business.data))
    throw new Error("Enable the live business calendar before offering internal appointments.");
  const now = new Date().toISOString(),
    until = new Date(Date.now() + 7 * 86400000).toISOString();
  let busy: { start: string; end: string }[];
  let windows: AvailabilityWindow[] | undefined;
  if (provider === "northstar_internal") {
    const [appointments, availability] = await Promise.all([
      admin
        .from("crm_appointments")
        .select("start_at,end_at")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .in("status", ["proposed", "booked", "confirmed"])
        .lt("start_at", until)
        .gt("end_at", now),
      admin
        .from("crm_availability_windows")
        .select("weekday,start_time,end_time,appointment_minutes")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .eq("active", true),
    ]);
    if (appointments.error || availability.error)
      throw new Error("Calendar availability could not be checked.");
    if (!availability.data?.length && !activation)
      throw new Error(
        "Set business availability before offering appointments.",
      );
    busy = (appointments.data ?? []).map((a) => ({
      start: a.start_at,
      end: a.end_at,
    }));
    windows = availability.data;
  } else {
    const credentials = await readProviderCredentials<
      GoogleCalendarCredentials & WorkspaceCredentials
    >(admin, source.data!.id);
    if (!credentials?.refreshToken)
      throw new Error("Reconnect the calendar to check availability.");
    busy = await (
      provider === "microsoft_365"
        ? getMicrosoftBusyIntervals
        : provider === "google_workspace"
          ? getGoogleWorkspaceBusyIntervals
          : getBusyIntervals
    )(credentials, now, until);
  }
  const timezone =
    activation?.timezone ?? business.data.timezone ?? "America/Chicago";
  if (provider === "northstar_internal")
    windows = reviewedInternalAvailabilityWindows(windows ?? [], activation);
  else if (activation)
    windows = activation.booking_weekdays.map((weekday) => ({
      weekday,
      start_time: `${String(activation.booking_start_hour).padStart(2, "0")}:00`,
      end_time: `${String(activation.booking_end_hour).padStart(2, "0")}:00`,
      appointment_minutes: activation.booking_minutes,
    }));
  const slots = computeOpenSlots(busy, {
    timezone,
    maxSlots: 3,
    maxPerDay: 3,
    businessStartHour:
      activation?.booking_start_hour ?? knowledge?.booking_hours_start ?? 9,
    businessEndHour:
      activation?.booking_end_hour ?? knowledge?.booking_hours_end ?? 17,
    durationMinutes:
      activation?.booking_minutes ??
      knowledge?.appointment_duration_minutes ??
      60,
    availabilityWindows: windows,
    constraints: parseSchedulingConstraints(preference),
  }).map((s) => ({
    start_iso: s.startIso,
    end_iso: s.endIso,
    label: formatSlotLabel(s.startIso, timezone),
  }));
  return {
    slots,
    timezone,
    provider,
    calendar_connection_id:
      provider === "northstar_internal" ? null : source.data!.id,
    checked_at: new Date().toISOString(),
  };
}

export async function checkSelectedSlot(
  admin: SupabaseClient,
  scope: AgentScope,
  request: {
    slot: OfferedSlot;
    provider: string;
    calendarConnectionId: string | null;
  },
) {
  const activation = await readActivationPlan(admin, scope);
  if (
    activation &&
    (!activation.bookings ||
      activation.status !== "active" ||
      activation.workspace_connection_id !== request.calendarConnectionId)
  )
    return false;
  const { slot } = request;
  if (
    activation &&
    !slotFitsActivation(activation, slot.start_iso, slot.end_iso)
  )
    return false;
  const start = Date.parse(slot?.start_iso),
    end = Date.parse(slot?.end_iso);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= Date.now() ||
    end <= start
  )
    return false;
  let busy: { start: string; end: string }[];
  if (request.provider === "northstar_internal") {
    const appointments = await admin
      .from("crm_appointments")
      .select("start_at,end_at")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .in("status", ["proposed", "booked", "confirmed"])
      .lt("start_at", slot.end_iso)
      .gt("end_at", slot.start_iso);
    if (appointments.error)
      throw new Error("Calendar availability could not be checked.");
    busy = (appointments.data ?? []).map((a) => ({
      start: a.start_at,
      end: a.end_at,
    }));
  } else {
    if (
      !request.calendarConnectionId ||
      !EXTERNAL_CALENDAR_PROVIDER_KEYS.includes(
        request.provider as ExternalCalendarProvider,
      )
    )
      throw new Error("The selected calendar is unavailable.");
    const connection = await admin
      .from("integration_connections")
      .select("id,provider:integration_providers!inner(provider_key)")
      .eq("id", request.calendarConnectionId)
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .eq("provider.provider_key", request.provider)
      .in("status", ["connected", "needs_attention"])
      .single();
    if (connection.error)
      throw new Error("Reconnect the calendar that offered this time.");
    const credentials = await readProviderCredentials<
      GoogleCalendarCredentials & WorkspaceCredentials
    >(admin, connection.data.id);
    if (!credentials?.refreshToken)
      throw new Error("Reconnect the calendar to check availability.");
    busy = await (
      request.provider === "microsoft_365"
        ? getMicrosoftBusyIntervals
        : request.provider === "google_workspace"
          ? getGoogleWorkspaceBusyIntervals
          : getBusyIntervals
    )(credentials, slot.start_iso, slot.end_iso);
  }
  return !busy.some((interval) => {
    const from = Date.parse(interval.start),
      until = Date.parse(interval.end);
    if (!Number.isFinite(from) || !Number.isFinite(until))
      throw new Error("Calendar returned invalid availability.");
    return from < end && until > start;
  });
}
