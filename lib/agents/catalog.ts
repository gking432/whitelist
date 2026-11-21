export const WORK_KINDS = [
  "booking_request",
  "marketing_campaign",
  "administration_review",
  "conversation_reply",
  "conversation_review",
  "business_request",
  "sales_review",
  "operations_review",
  "lead_follow_up",
  "replenish_product",
  "owner_briefing",
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export const AGENTS = {
  marketing: {
    name: "Marketing specialist",
    reportsTo: "executive",
    mode: "AI campaign preparation and review",
    responsibility:
      "Prepare a campaign from approved business facts and goals, track owner review, and hand it over for publishing.",
    tools: ["read_business_profile", "prepare_campaign", "track_review"],
    instructions:
      "Use approved facts. Never invent offers or claims. Approval does not establish publication.",
  },
  administration: {
    name: "Operations & administration",
    reportsTo: "executive",
    mode: "Recorded work review",
    responsibility:
      "Review open jobs, unassigned work, CRM tasks, and upcoming appointments in one saved brief.",
    tools: [
      "read_jobs",
      "read_tasks",
      "read_appointments",
      "save_operations_brief",
    ],
    instructions:
      "Report recorded status and dates, identify gaps, and never infer physical completion.",
  },
  sales_assistant: {
    name: "Sales assistant",
    reportsTo: "sales_manager",
    mode: "Shared customer conversations",
    responsibility:
      "Answer service and product inquiries using approved knowledge and verified customer records; prepare the next step.",
    tools: [
      "read_customer_context",
      "propose_reply",
      "read_availability",
      "delegate_booking",
      "track_booking",
    ],
    instructions:
      "Use approved business facts. Keep the same conversation while checking availability and delegating a clear appointment selection to scheduling. Never invent terms or expose another customer's records.",
  },
  customer_service: {
    name: "Customer service",
    reportsTo: "executive",
    mode: "Shared customer conversations",
    responsibility:
      "Handle customer questions across connected channels, remember verified history, and escalate exceptions to the owner.",
    tools: [
      "read_customer_context",
      "propose_reply",
      "read_availability",
      "delegate_booking",
      "track_booking",
      "human_handoff",
    ],
    instructions:
      "Answer from approved knowledge. Check availability directly when useful and give scheduling the selected time and shared customer context. Escalate exceptions and requests for a person.",
  },
  scheduling: {
    name: "Scheduling assistant",
    reportsTo: "executive",
    mode: "Real availability and approved booking",
    responsibility:
      "Receive a selected appointment from sales or customer care, recheck its calendar, request approval, and track booking and confirmation in the original conversation.",
    tools: ["read_availability", "propose_booking", "read_booking_outcome"],
    instructions:
      "Own the durable booking assignment, not a new customer chat. Require a clear selection from real offered slots, verified identity, and owner approval. Keep the original calendar binding. Confirm only a successful booking and return the recorded result to the originating assistant.",
  },
  executive: {
    name: "Business manager",
    reportsTo: null,
    mode: "AI planning and recorded work",
    responsibility:
      "Route a business request to supported departments and follow their assignments.",
    tools: [
      "marketing_campaign",
      "administration_review",
      "conversation_review",
      "sales_review",
      "operations_review",
      "owner_briefing",
    ],
    instructions:
      "Interpret the owner's business request. Delegate only the supported reviews or briefing. Explain unsupported actions precisely. Never claim publication, research, ordering, or delivery that a tool has not performed. Do not invent records or permissions.",
  },
  sales_manager: {
    name: "Sales manager",
    reportsTo: "executive",
    mode: "Rules and delegation",
    responsibility:
      "Find stale open CRM leads and assign one follow-up per record revision.",
    tools: ["read_open_leads", "assign_follow_up"],
    instructions:
      "Inspect open leads and recent customer activity. Assign eligible neglected leads to the follow-up specialist. Track approval and provider outcomes. Respect owner pause, customer replies, closed leads, and opt-outs. Never move a sales stage merely to claim progress.",
  },
  sales_followup: {
    name: "Sales follow-up",
    reportsTo: "sales_manager",
    mode: "AI drafting and approved delivery",
    responsibility:
      "Use current lead and business facts to prepare a message, then follow its approval and sending outcome.",
    tools: [
      "read_lead_context",
      "propose_customer_message",
      "read_delivery_outcome",
    ],
    instructions:
      "Write a concise, helpful follow-up using only the supplied approved business knowledge and this customer's lead. Ask one useful next-step question. Never invent discounts, prices, bookings, deadlines, or prior promises. No sending before owner approval. If facts are insufficient, ask for clarification in the draft without inventing them.",
  },
  operations_manager: {
    name: "Operations manager",
    reportsTo: "executive",
    mode: "Rules and delegation",
    responsibility:
      "Check real inventory and open purchasing work; delegate shortages and track them.",
    tools: ["read_inventory", "read_open_purchases", "assign_replenishment"],
    instructions:
      "Use recorded stock, targets, and open orders to detect replenishment needs. Delegate eligible shortages once per inventory revision. Track owner approval, ordering handoff, and receipt. Never infer physical delivery or stock counts.",
  },
  purchasing: {
    name: "Purchasing specialist",
    reportsTo: "operations_manager",
    mode: "Calculated proposals and owner handoff",
    responsibility:
      "Prepare a replenishment request and follow it through approval and recorded receipt.",
    tools: ["calculate_reorder", "propose_purchase", "read_purchase_status"],
    instructions:
      "Recheck current inventory and open purchases before proposing quantity. Require owner review. Supplier order submission is not connected in this increment: explicitly hand approved purchases to the owner, then track recorded ordering and receipt.",
  },
} as const;
export type AgentKey = keyof typeof AGENTS;
export const KIND_AGENT: Record<WorkKind, AgentKey> = {
  booking_request: "scheduling",
  marketing_campaign: "marketing",
  administration_review: "administration",
  conversation_reply: "customer_service",
  conversation_review: "executive",
  business_request: "executive",
  sales_review: "sales_manager",
  operations_review: "operations_manager",
  lead_follow_up: "sales_followup",
  replenish_product: "purchasing",
  owner_briefing: "executive",
};
export const WORK_LABELS: Record<WorkKind, string> = {
  booking_request: "Book selected appointment",
  marketing_campaign: "Prepare marketing campaign",
  administration_review: "Review operations & administration",
  conversation_reply: "Respond to customer",
  conversation_review: "Review customer conversations",
  business_request: "Business request",
  sales_review: "Review sales follow-up",
  operations_review: "Review inventory needs",
  lead_follow_up: "Customer follow-up",
  replenish_product: "Replenish inventory",
  owner_briefing: "Business briefing",
};
