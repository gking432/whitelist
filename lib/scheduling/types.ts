// Scheduling / calendar provider abstraction — CONTRACT ONLY (Phase 3 of
// docs/11). No booking implementation exists in this release. The interface
// is provider-first so Google Calendar, Outlook, CRM calendars, and a clean
// internal calendar can all sit behind the same contract, and so AI voice
// can query availability in real time during a call.
//
// Northstar reference concepts carried over: canonical bookable slots (the
// assistant only ever offers real slots, never invented times), resolving
// loose spoken constraints ("tomorrow after 2", "mornings are better")
// against actual availability, and booking only after confirmation.

export type WorkerRef = {
  id: string;
  displayName: string;
  role: "estimator" | "technician" | "crew" | "office";
  territories: string[];
};

export type AppointmentSlot = {
  start: string; // ISO 8601
  end: string;
  workerId: string;
  label: string; // human/voice-friendly, e.g. "Tue, Jul 7 at 2:30 PM"
};

// Constraints extracted from calls/SMS/email/forms. Free-text constraints
// are resolved by the scheduling layer, not by the AI inventing times.
export type AvailabilityQuery = {
  partnerId: string;
  clientId: string;
  serviceType: string | null;
  durationMinutes: number;
  windowStart: string;
  windowEnd: string;
  territory: string | null;
  workerIds: string[] | null;
  customerConstraints: {
    text: string | null; // e.g. "I work until 5", "not tomorrow"
    earliestHour: number | null;
    latestHour: number | null;
    excludedDates: string[];
  };
  limit: number;
};

export type BookingRequest = {
  partnerId: string;
  clientId: string;
  slot: AppointmentSlot;
  customer: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  serviceType: string | null;
  sourceRunId: string | null; // workflow run that proposed the booking
  // Bookings follow the same approval policy machinery as messages: in
  // sandbox/dry_run nothing external changes; in live mode the client's
  // appointment-change approval policy applies before confirm() executes.
  requiresApproval: boolean;
};

export type BookingResult =
  | { status: "booked"; externalEventRef: string; slot: AppointmentSlot }
  | { status: "conflict"; alternatives: AppointmentSlot[] }
  | { status: "pending_approval"; approvalItemId: string }
  | { status: "failed"; errorCode: string; errorMessage: string };

export interface CalendarProvider {
  providerKey: string;

  listWorkers(input: {
    partnerId: string;
    clientId: string;
  }): Promise<WorkerRef[]>;

  // Must return only genuinely open slots (existing bookings, travel
  // windows, and business rules already applied) so callers can offer any
  // returned slot directly to a customer.
  getAvailableSlots(query: AvailabilityQuery): Promise<AppointmentSlot[]>;

  // Two-phase booking so AI voice can hold a slot during confirmation and
  // release it if the caller declines.
  holdSlot(input: {
    slot: AppointmentSlot;
    ttlSeconds: number;
  }): Promise<{ holdRef: string } | { error: "slot_taken" }>;

  book(request: BookingRequest, holdRef: string | null): Promise<BookingResult>;

  reschedule(input: {
    externalEventRef: string;
    newSlot: AppointmentSlot;
    reason: string | null;
  }): Promise<BookingResult>;

  cancel(input: {
    externalEventRef: string;
    reason: string | null;
  }): Promise<{ cancelled: boolean }>;
}

// Every successful book/reschedule/cancel must also:
// 1. write an integration_event (appointment.booked / .rescheduled /
//    .cancelled) so workflows (confirmation drafts, reminders) trigger;
// 2. push the change into the client's CRM via the CRM sync adapter;
// 3. record an audit event when a human resolved an approval to allow it.
