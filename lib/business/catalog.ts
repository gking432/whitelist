import type { BusinessProfile, RecordKind } from "./types.ts";

export const INDUSTRIES = [
  {
    key: "general",
    label: "Other business",
    description: "A setup shaped around the work you do.",
  },
  {
    key: "salon",
    label: "Salon & beauty",
    description: "Appointments, loyal customers, and well-stocked shelves.",
  },
  {
    key: "trainer",
    label: "Fitness & coaching",
    description: "Consultations, programs, and client follow-through.",
  },
  {
    key: "retail",
    label: "Shop & reseller",
    description: "Source, stock, promote, sell, and fulfill.",
  },
  {
    key: "services",
    label: "Home & field services",
    description: "Inquiries, estimates, materials, and jobs.",
  },
  {
    key: "professional",
    label: "Professional services",
    description: "Clients, documents, projects, and deadlines.",
  },
] as const;
export const BUSINESS_GOALS = [
  "Get more customers",
  "Save time",
  "Fill appointments",
  "Find products & suppliers",
  "Manage purchasing",
  "Keep work on track",
  "Improve marketing",
  "Follow up consistently",
];
export type Recipe = {
  key: string;
  name: string;
  area: string;
  description: string;
  outcome: string;
  inputs: string;
  industries: string[];
  goals: string[];
  output: RecordKind | null;
  mode: "workspace" | "connection";
  connection: string | null;
  schedule: boolean;
  steps: string[];
};
export const BUSINESS_RECIPES: Recipe[] = [
  {
    key: "marketing-studio",
    name: "Marketing studio",
    area: "Marketing",
    description: "Turn a business goal into a campaign you can review and use.",
    outcome: "Campaign brief, audience, copy, and a next step",
    inputs: "Your offer, audience, and desired outcome",
    industries: [],
    goals: ["Improve marketing", "Get more customers"],
    output: "campaign",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read your business profile",
      "Prepare campaign copy",
      "Review and approve",
      "Copy or export for publishing",
    ],
  },
  {
    key: "sourcing-analyst",
    name: "Sourcing analyst",
    area: "Sourcing",
    description:
      "Compare saved buying opportunities with transparent costs and margin assumptions.",
    outcome: "Ranked shortlist with source references",
    inputs:
      "Add opportunities with price, shipping, fees, and expected resale value",
    industries: ["retail", "services"],
    goals: ["Find products & suppliers"],
    output: "brief",
    mode: "workspace",
    connection: null,
    schedule: true,
    steps: [
      "Read saved opportunities",
      "Calculate landed costs",
      "Compare expected margins",
      "Prepare a buying decision",
    ],
  },
  {
    key: "purchasing-planner",
    name: "Purchasing planner",
    area: "Purchasing",
    description:
      "Spot stock below its reorder point and prepare purchase requests.",
    outcome: "Purchase requests for owner review",
    inputs: "Inventory quantities, reorder points, and unit costs",
    industries: ["retail", "salon", "services"],
    goals: ["Manage purchasing"],
    output: "purchase",
    mode: "workspace",
    connection: null,
    schedule: true,
    steps: [
      "Check current inventory",
      "Account for open purchase requests",
      "Prepare replenishment quantities",
      "Ask before ordering",
    ],
  },
  {
    key: "operations-coordinator",
    name: "Operations coordinator",
    area: "Operations",
    description:
      "Find blocked and overdue work and prepare a practical daily action list.",
    outcome: "Operations briefing grounded in your jobs",
    inputs: "Jobs, assignees, due dates, and blockers",
    industries: [],
    goals: ["Keep work on track", "Save time"],
    output: "brief",
    mode: "workspace",
    connection: null,
    schedule: true,
    steps: [
      "Review open jobs",
      "Find blockers and deadlines",
      "Prioritize attention",
      "Save a briefing",
    ],
  },
  {
    key: "listing-assistant",
    name: "Listing assistant",
    area: "Marketing",
    description:
      "Prepare factual product descriptions from the inventory you select.",
    outcome: "Listing draft with stock and price context",
    inputs: "Inventory records and a brief",
    industries: ["retail"],
    goals: ["Improve marketing"],
    output: "campaign",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read available inventory",
      "Use recorded product facts",
      "Draft a listing",
      "Ask for review",
    ],
  },
  {
    key: "followup-assistant",
    name: "Follow-up assistant",
    area: "Customers",
    description:
      "Prepare a follow-up message for a customer or an approved audience.",
    outcome: "Reviewable message draft",
    inputs: "The customer context and reason for following up",
    industries: [],
    goals: ["Follow up consistently"],
    output: "campaign",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read the supplied context",
      "Prepare a relevant message",
      "Ask for review",
      "Hand off for sending",
    ],
  },
  {
    key: "document-assistant",
    name: "Document assistant",
    area: "Operations",
    description:
      "Turn pasted business notes into a reusable procedure or checklist.",
    outcome: "An editable knowledge record",
    inputs: "Paste the notes or procedure to organize",
    industries: ["professional", "services"],
    goals: ["Save time", "Keep work on track"],
    output: "knowledge",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read supplied notes",
      "Organize the facts",
      "Identify missing details",
      "Save for review",
    ],
  },
  {
    key: "owner-briefing",
    name: "Owner briefing",
    area: "Operations",
    description:
      "Bring approvals, open work, campaigns, and stock into one daily update.",
    outcome: "A business briefing with links to the records",
    inputs: "Your workspace records",
    industries: [],
    goals: ["Save time"],
    output: "brief",
    mode: "workspace",
    connection: null,
    schedule: true,
    steps: [
      "Read current records",
      "Count work needing attention",
      "Summarize changes",
      "Save a daily briefing",
    ],
  },
  {
    key: "website-concierge",
    name: "Website concierge",
    area: "Customers",
    description:
      "Answer from your business knowledge and capture new inquiries.",
    outcome: "Website conversations and customer intake",
    inputs: "Approved knowledge and an installed website widget",
    industries: [],
    goals: ["Get more customers"],
    output: null,
    mode: "connection",
    connection: "website",
    schedule: false,
    steps: [
      "Add business knowledge",
      "Set up a chat widget",
      "Install on your website",
      "Test a real conversation",
    ],
  },
  {
    key: "booking-coordinator",
    name: "Booking coordinator",
    area: "Customers",
    description:
      "Prepare appointment requests using a connected calendar and owner approvals.",
    outcome: "Reviewed booking proposals",
    inputs: "Calendar, services, and booking rules",
    industries: ["salon", "trainer", "services", "professional"],
    goals: ["Fill appointments"],
    output: null,
    mode: "connection",
    connection: "calendar",
    schedule: false,
    steps: [
      "Connect a calendar",
      "Set availability and services",
      "Test a booking request",
      "Review in Approvals",
    ],
  },
  {
    key: "review-followup",
    name: "Review & rebooking",
    area: "Marketing",
    description: "Draft a helpful review request or a reminder to book again.",
    outcome: "Reviewable retention campaign",
    inputs: "Completed service and preferred next step",
    industries: ["salon", "trainer", "services"],
    goals: ["Follow up consistently"],
    output: "campaign",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read the service context",
      "Prepare the follow-up",
      "Review audience and timing",
      "Hand off for sending",
    ],
  },
  {
    key: "payment-followup",
    name: "Payment follow-up",
    area: "Operations",
    description:
      "Prepare reminders from unpaid invoice records without inventing balances.",
    outcome: "Invoice reminder drafts",
    inputs: "Invoice amount, due date, and customer reference",
    industries: ["services", "professional"],
    goals: ["Follow up consistently"],
    output: "campaign",
    mode: "workspace",
    connection: null,
    schedule: false,
    steps: [
      "Read unpaid invoices",
      "Use recorded amounts and dates",
      "Prepare a reminder",
      "Ask before sending",
    ],
  },
];
export function inferIndustry(description: string): string {
  const text = description.toLowerCase();
  if (/salon|hair|beauty|barber|nail|spa\b/.test(text)) return "salon";
  if (/trainer|fitness|gym|coach|yoga|pilates/.test(text)) return "trainer";
  if (/golf|shop|retail|resell|ecommerce|e-commerce|inventory/.test(text))
    return "retail";
  if (/plumb|electric|roof|hvac|landscap|contractor|cleaning|repair/.test(text))
    return "services";
  if (/consult|account|law|legal|design|professional/.test(text))
    return "professional";
  return "general";
}
export function recommendRecipes(
  profile: BusinessProfile,
): { recipe: Recipe; reason: string; score: number }[] {
  return BUSINESS_RECIPES.map((recipe) => {
    const goal = recipe.goals.find((g) => profile.goals.includes(g));
    const industry = recipe.industries.includes(profile.industry);
    const score =
      (goal ? 5 : 0) +
      (industry ? 3 : 0) +
      (recipe.key === "owner-briefing" ? 1 : 0);
    return {
      recipe,
      score,
      reason: goal
        ? `Supports your goal: ${goal.toLowerCase()}.`
        : industry
          ? `Useful for ${INDUSTRIES.find((i) => i.key === profile.industry)?.label.toLowerCase() ?? "your business"}.`
          : "Available when this work becomes a priority.",
    };
  }).sort((a, b) => b.score - a.score);
}
