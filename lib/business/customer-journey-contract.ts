export type CustomerJourneyState = "unknown" | "requested" | "draft" | "needs_owner" | "queued" | "provider_pending" | "confirmed" | "scheduled" | "cancelled" | "review" | "complete";
export type CustomerJourneySource = { kind: string; id: string; revision?: string; href?: string };
export type CustomerJourneyStage = {
  key: "inquiry" | "lead" | "assignment" | "approval" | "booking" | "confirmation" | "reminder" | "cancellation" | "time_change" | "rebooking";
  status: CustomerJourneyState; summary: string; updatedAt: string | null;
  sources: CustomerJourneySource[]; href?: string;
};
export type CustomerJourneyCommandName = "progress_inquiry" | "select_intake_slot" | "recover_confirmation" | "prepare_reminder" | "request_cancellation" | "prepare_cancellation" | "prepare_time_change" | "prepare_rebooking" | "qualify_rebooking";
export type CustomerJourneyAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "command"; label: string; command: CustomerJourneyCommandName; targetId: string; expectedRevision: string; requiresSlot?: boolean; requiresQualification?: boolean };
export type CustomerJourney = {
  id: string; title: string; customer: { id: string; name: string; identity: "unverified" | "owner_verified" | "unknown"; email?: string | null; phone?: string | null };
  leadId: string; conversationId: string | null; revision: string; updatedAt: string;
  warnings: string[]; stages: CustomerJourneyStage[]; nextAction: CustomerJourneyAction | null; actions?: CustomerJourneyAction[];
  observations?: { key: string; label: string; seconds: number; detail: string; sources: CustomerJourneySource[] }[];
  calendarReview?: {
    bookingApprovalId: string; revision: string; provider: string; timezone: string;
    current: CustomerJourneySlot; status: string; writeAllowed: boolean; writeDetail: string; sources: CustomerJourneySource[];
  };
  qualificationReview?: { detail: string; instructions: string; sources: CustomerJourneySource[] };
};
export type CustomerJourneySnapshot = {
  version: 1; generatedAt: string; canWrite: boolean; limited: boolean; errors: string[]; journeys: CustomerJourney[];
};
export type CustomerJourneySlot = { start_iso: string; end_iso: string; label: string };
export type CustomerJourneyOffer = {
  id: string; expiresAt: string; provider: string; timezone: string;
  slots: CustomerJourneySlot[]; detail: string;
  targetId?: string; revision?: string;
};
