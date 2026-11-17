import type {
  CustomerJourney,
  CustomerJourneyAction,
  CustomerJourneyCommandName,
  CustomerJourneyOffer,
  CustomerJourneySlot,
  CustomerJourneyStage,
  CustomerJourneyState,
  CustomerJourneySnapshot,
} from "./customer-journey-contract.ts";

export type JourneyFilter = { leadId?: string; conversationId?: string; taskId?: string };
export type JourneyQualification = { service: string; preference?: string; identityConfirmed: boolean; bookingRequested: boolean; instructionsReviewed?: boolean };
export type JourneyCommand = {
  action: CustomerJourneyCommandName; key: string; targetId: string; expectedRevision: string;
  offerId?: string; slot?: CustomerJourneySlot; qualification?: JourneyQualification;
};
export type JourneyReceipt = { id: string; message: string; replayed: boolean };

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const commands = new Set<CustomerJourneyCommandName>([
  "progress_inquiry", "select_intake_slot", "recover_confirmation", "prepare_reminder", "request_cancellation", "prepare_rebooking",
  "prepare_cancellation", "prepare_time_change", "qualify_rebooking",
]);
export const JOURNEY_STAGE_LABELS: Record<CustomerJourneyStage["key"], string> = {
  inquiry: "Inquiry", lead: "Shared lead", assignment: "Assigned work", approval: "Owner decision",
  booking: "Booking", confirmation: "Confirmation", reminder: "Reminder", cancellation: "Cancellation", time_change: "Time change", rebooking: "Rebooking",
};
export const JOURNEY_STATE_LABELS: Record<CustomerJourneyState, string> = {
  unknown: "Not verified", requested: "Requested", draft: "Draft", needs_owner: "Needs your decision", queued: "Queued",
  provider_pending: "Provider result pending", confirmed: "Confirmed result", scheduled: "Scheduled", cancelled: "Cancelled",
  review: "Needs review", complete: "Recorded",
};
export function journeyStateDetail(state: CustomerJourneyState): string {
  const detail: Partial<Record<CustomerJourneyState, string>> = {
    requested: "A request is saved; its outcome is still pending.",
    draft: "Prepared work awaits review. Delivery is not established by a draft.",
    queued: "Saved for background work; completion has not been verified.",
    provider_pending: "The external result needs verification before repeating the action.",
    scheduled: "Work has a saved schedule. Scheduling does not establish delivery.",
    unknown: "The available records do not verify this stage.",
  };
  return detail[state] ?? "";
}
export function formatJourneyElapsed(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "Under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}${hours % 24 ? ` ${hours % 24} hr` : ""}`;
}
export function safeJourneyHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("/") && !/[\\\r\n]/.test(value)) {
    try {
      const url = new URL(value, "https://journey.invalid");
      if (url.origin === "https://journey.invalid" && (url.pathname === "/client" || url.pathname.startsWith("/client/")))
        return `${url.pathname}${url.search}${url.hash}`;
    } catch { return null; }
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function journeyQuery(filter: JourneyFilter): string {
  const params = new URLSearchParams();
  for (const key of ["leadId", "conversationId", "taskId"] as const)
    if (filter[key] && uuid.test(filter[key]!)) params.set(key, filter[key]!);
  return params.toString();
}
export function customerJourneyHref(filter: JourneyFilter = {}): string {
  const query = journeyQuery(filter);
  return `/client/customer-work${query ? `?${query}` : ""}`;
}
export function invalidJourneyFilter(filter: JourneyFilter): boolean {
  return (["leadId", "conversationId", "taskId"] as const).some((key) =>
    filter[key] !== undefined && (typeof filter[key] !== "string" || !uuid.test(filter[key]!)));
}
export function visibleCustomerJourneys(snapshot: CustomerJourneySnapshot, filter: JourneyFilter): CustomerJourney[] {
  if (invalidJourneyFilter(filter)) return [];
  return snapshot.journeys.filter((journey) =>
    (!filter.leadId || journey.leadId.toLowerCase() === filter.leadId.toLowerCase()) &&
    (!filter.conversationId || journey.conversationId?.toLowerCase() === filter.conversationId.toLowerCase()) &&
    (!filter.taskId || journey.stages.some((stage) => stage.sources.some((source) => source.id.toLowerCase() === filter.taskId!.toLowerCase()))));
}
export function journeyActions(journey: CustomerJourney, canWrite: boolean): CustomerJourneyAction[] {
  const seen = new Set<string>();
  return [journey.nextAction, ...(journey.actions ?? [])].filter((action): action is CustomerJourneyAction => {
    if (!action?.label?.trim()) return false;
    if (action.kind === "link" && !safeJourneyHref(action.href)) return false;
    if (action.kind === "command" && (!canWrite || !commands.has(action.command) || !uuid.test(action.targetId) || !action.expectedRevision)) return false;
    if (action.kind === "command" && journeyActionIsCalendarChange(action) &&
      (!calendarReviewMatchesAction(journey.calendarReview, action) || !journey.calendarReview?.writeAllowed)) return false;
    if (action.kind === "command" && action.command === "qualify_rebooking" && !journey.qualificationReview) return false;
    const key = action.kind === "link" ? `link:${action.href}` : `${action.command}:${action.targetId}:${action.expectedRevision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function journeyActionNeedsSlot(action: Extract<CustomerJourneyAction, { kind: "command" }>): boolean {
  return action.requiresSlot === true || action.command === "select_intake_slot" || action.command === "prepare_time_change";
}
export function journeyActionIsCurrent(journey: CustomerJourney, action: Extract<CustomerJourneyAction, { kind: "command" }>, canWrite: boolean): boolean {
  return journeyActions(journey, canWrite).some((current) => current.kind === "command" && current.command === action.command &&
    current.targetId === action.targetId && current.expectedRevision === action.expectedRevision);
}
export function journeyActionNeedsQualification(action: Extract<CustomerJourneyAction, { kind: "command" }>): boolean {
  return action.requiresQualification === true || action.command === "progress_inquiry" || action.command === "qualify_rebooking";
}
export function journeyActionIsCalendarChange(action: Extract<CustomerJourneyAction, { kind: "command" }>): boolean {
  return action.command === "prepare_cancellation" || action.command === "prepare_time_change";
}
export function calendarReviewMatchesAction(review: CustomerJourney["calendarReview"], action: Extract<CustomerJourneyAction, { kind: "command" }>): boolean {
  return !!review && review.bookingApprovalId === action.targetId && review.revision === action.expectedRevision &&
    Number.isFinite(Date.parse(review.current.start_iso)) && Number.isFinite(Date.parse(review.current.end_iso)) &&
    Date.parse(review.current.end_iso) > Date.parse(review.current.start_iso);
}
export function journeyAvailabilityQuery(leadId: string, action: Extract<CustomerJourneyAction, { kind: "command" }>): string {
  if (!uuid.test(leadId) || !uuid.test(action.targetId)) throw new Error("Refresh customer progress before loading availability.");
  return action.command === "prepare_time_change"
    ? new URLSearchParams({ bookingApprovalId: action.targetId, purpose: "time_change" }).toString()
    : new URLSearchParams({ leadId }).toString();
}
export function readJourneyOffer(value: unknown, action: Extract<CustomerJourneyAction, { kind: "command" }>, now = Date.now()): CustomerJourneyOffer {
  const offer = value as CustomerJourneyOffer | null;
  if (!offer || !uuid.test(offer.id) || !Array.isArray(offer.slots) || !Number.isFinite(Date.parse(offer.expiresAt)) ||
    Date.parse(offer.expiresAt) <= now || typeof offer.timezone !== "string" || typeof offer.provider !== "string" || typeof offer.detail !== "string" ||
    offer.slots.some((slot) => !slot || typeof slot.label !== "string" || !slot.label.trim() || !Number.isFinite(Date.parse(slot.start_iso)) ||
      !Number.isFinite(Date.parse(slot.end_iso)) || Date.parse(slot.start_iso) <= now || Date.parse(slot.end_iso) <= Date.parse(slot.start_iso)))
    throw new Error("Load a current availability offer and explicitly choose a time.");
  if (action.command === "select_intake_slot" && offer.id !== action.targetId)
    throw new Error("The scheduling assignment changed. Refresh customer progress before choosing a time.");
  if (action.command === "prepare_time_change" && (offer.targetId !== action.targetId || offer.revision !== action.expectedRevision))
    throw new Error("The appointment source changed. Refresh customer progress before choosing a new time.");
  return offer;
}
export function buildJourneyCommand(
  action: Extract<CustomerJourneyAction, { kind: "command" }>, key: string,
  values: { qualification?: JourneyQualification; qualificationReview?: CustomerJourney["qualificationReview"]; calendarReview?: CustomerJourney["calendarReview"]; offer?: CustomerJourneyOffer | null; slot?: CustomerJourneySlot | null } = {},
  now = Date.now(),
): JourneyCommand {
  if (!commands.has(action.command) || !uuid.test(key) || !uuid.test(action.targetId) || !action.expectedRevision)
    throw new Error("Refresh the customer journey before choosing this action.");
  const request: JourneyCommand = { action: action.command, key, targetId: action.targetId, expectedRevision: action.expectedRevision };
  if (journeyActionIsCalendarChange(action)) {
    if (!calendarReviewMatchesAction(values.calendarReview, action))
      throw new Error("Refresh and review the current appointment source before preparing a change.");
    if (!values.calendarReview?.writeAllowed) throw new Error(values.calendarReview?.writeDetail || "This calendar does not permit this change.");
  }
  if (journeyActionNeedsQualification(action)) {
    const q = values.qualification;
    if (!q?.service.trim() || !q.identityConfirmed || !q.bookingRequested)
      throw new Error("Enter the requested service and explicitly confirm the customer identity and booking request.");
    if (q.service.trim().length > 200 || (q.preference?.trim().length ?? 0) > 500)
      throw new Error("Keep the service within 200 characters and timing preference within 500 characters.");
    if (action.command === "qualify_rebooking" && (!values.qualificationReview || !q.instructionsReviewed))
      throw new Error("Review the current customer instructions and explicitly confirm that review before rebooking.");
    request.qualification = {
      service: q.service.trim(), ...(q.preference?.trim() ? { preference: q.preference.trim() } : {}),
      identityConfirmed: true, bookingRequested: true,
      ...(action.command === "qualify_rebooking" ? { instructionsReviewed: true } : {}),
    };
  }
  if (journeyActionNeedsSlot(action)) {
    const { offer, slot } = values;
    if (!offer || !slot)
      throw new Error("Load a current availability offer and explicitly choose a time.");
    readJourneyOffer(offer, action, now);
    if (!offer.slots.some((item) => item.start_iso === slot.start_iso && item.end_iso === slot.end_iso && item.label === slot.label) ||
        !Number.isFinite(Date.parse(slot.start_iso)) || !Number.isFinite(Date.parse(slot.end_iso)) ||
        Date.parse(slot.start_iso) <= now || Date.parse(slot.end_iso) <= Date.parse(slot.start_iso))
      throw new Error("Choose an unchanged future time from the current offer.");
    request.offerId = offer.id;
    request.slot = { start_iso: slot.start_iso, end_iso: slot.end_iso, label: slot.label };
  }
  return request;
}
export function readJourneyReceipt(value: unknown): JourneyReceipt {
  const receipt = value as Partial<JourneyReceipt> | null;
  if (!receipt || typeof receipt.id !== "string" || !receipt.id || typeof receipt.message !== "string" ||
      !receipt.message.trim() || typeof receipt.replayed !== "boolean")
    throw new Error("A saved result was not confirmed. Retry the same request to check its receipt.");
  return { id: receipt.id, message: receipt.message, replayed: receipt.replayed };
}
