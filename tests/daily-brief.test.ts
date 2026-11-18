import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  buildDailyBrief,
  goalProgress,
  localDate,
  safeSourceUrl,
  validTimeZone,
  type DailyBriefData,
} from "../lib/business/daily-brief.ts";
import { EMPTY_PROFILE, type BusinessRecord } from "../lib/business/types.ts";
import { RECORD_SCHEMA } from "../lib/business/rules.ts";
import { buildFocusBrief } from "../lib/business/focus-brief.ts";

const record = (values: Partial<BusinessRecord>): BusinessRecord => ({
  id: "record",
  kind: "job",
  title: "Action",
  body: "",
  data: {},
  status: "draft",
  revision: 1,
  source_record_id: null,
  created_at: "2026-10-31T10:00:00Z",
  updated_at: "2026-10-31T10:00:00Z",
  ...values,
});
function data(records: BusinessRecord[] = []): DailyBriefData {
  return {
    workspace: {
      clientName: "Test",
      clientId: "client",
      profile: EMPTY_PROFILE,
      records,
      installs: [],
      events: [],
      contacts: [],
      connections: [],
      pendingCustomerApprovals: 0,
      aiConfigured: false,
      canWrite: true,
      isTestAccount: true,
      setupRequired: false,
      error: null,
    },
    displayName: "Owner",
    timeZone: "America/Chicago",
    generatedAt: "2026-10-31T15:00:00Z",
    tasks: [],
    appointments: [],
    approvals: [],
    conversations: [],
    work: [],
    teamStatus: "not_set_up",
    counts: { tasks: 0, approvals: 0, conversations: 0, blockedWork: 0 },
    errors: [],
    limited: false,
  };
}

test("the daily brief never claims all clear when apps are unconnected or sources are incomplete", () => {
  const state = data();
  assert.equal(buildFocusBrief(state).state, "unconnected");
  assert.equal(buildFocusBrief(state).link?.href, "/client/apps");
  assert.deepEqual(buildFocusBrief(state).sections, []);
  state.errors = ["Calendar unavailable"];
  assert.equal(buildFocusBrief(state).state, "incomplete");
  assert.doesNotMatch(buildFocusBrief(state).title, /all clear/i);
  state.errors = [];
  state.limited = true;
  assert.equal(buildFocusBrief(state).state, "incomplete");
});

test("the daily brief shows only remaining confirmed appointments on the business day", () => {
  const state = data();
  const appointment = {
    id: "next",
    title: "Consultation",
    start_at: "2026-10-31T20:30:00Z",
    end_at: "2026-10-31T21:30:00Z",
    status: "booked",
  };
  state.appointments = [
    {
      ...appointment,
      id: "past",
      start_at: "2026-10-31T12:00:00Z",
      end_at: "2026-10-31T13:00:00Z",
    },
    { ...appointment, id: "cancelled", status: "cancelled" },
    { ...appointment, id: "proposed", status: "proposed" },
    {
      ...appointment,
      id: "tomorrow",
      start_at: "2026-11-01T20:00:00Z",
      end_at: "2026-11-01T21:00:00Z",
    },
    appointment,
  ];
  const brief = buildFocusBrief(state);
  assert.equal(brief.title, "Your next appointment is at 3:30 PM.");
  assert.deepEqual(
    brief.rows.map((row) => row.key),
    ["appointment:next"],
  );
  state.generatedAt = "2026-10-31T21:00:00Z";
  assert.equal(
    buildFocusBrief(state).title,
    "Your appointment is in progress.",
  );
});

test("work below the greeting keeps messages and invoices visible even when other work fills the summary", () => {
  const state = data([
    ...Array.from({ length: 7 }, (_, index) =>
      record({ id: `action-${index}`, data: { due_date: "2026-10-30" } }),
    ),
    record({
      id: "invoice",
      kind: "invoice",
      title: "Project invoice",
      data: { customer: "Customer", amount: 125, due_date: "2026-11-02" },
    }),
    record({ id: "paid", kind: "invoice", status: "paid" }),
    record({ id: "archived", kind: "invoice", status: "archived" }),
  ]);
  state.conversations = [
    {
      id: "message",
      channel: "email",
      next_action: "Reply to inquiry",
      summary: "Customer needs a reply",
      updated_at: state.generatedAt,
    },
  ];
  state.counts.conversations = 1;
  const brief = buildFocusBrief(state);
  const messages = brief.sections.find((section) => section.key === "messages");
  const invoices = brief.sections.find((section) => section.key === "invoices");
  const todo = brief.sections.find((section) => section.key === "todo");
  assert.equal(messages?.rows[0].href, "/client/messages?id=message");
  assert.deepEqual(
    invoices?.rows.map((row) => row.recordId),
    ["invoice"],
  );
  assert.equal(invoices?.rows[0].label, "$125.00");
  assert.match(invoices?.rows[0].detail || "", /Draft/);
  assert.equal(todo?.rows.length, 4);
  assert.equal(todo?.remaining, 3);
  assert.equal(
    brief.sections.some((section) => section.key === "attention"),
    false,
  );
});

test("decisions take priority and urgent actions appear once in a bounded brief", () => {
  const state = data([
    record({ id: "decision", kind: "campaign", status: "needs_approval" }),
    ...Array.from({ length: 7 }, (_, index) =>
      record({ id: `action-${index}`, data: { due_date: "2026-10-30" } }),
    ),
    record({ id: "later", data: { due_date: "2026-11-05" } }),
  ]);
  const brief = buildFocusBrief(state);
  assert.equal(brief.state, "attention");
  assert.equal(brief.title, "1 decision needs you.");
  assert.equal(brief.link?.label, "Review decisions");
  assert.equal(brief.rows.length, 5);
  assert.equal(brief.remaining, 3);
  assert.equal(new Set(brief.rows.map((row) => row.key)).size, 5);
});

test("the brief uses the business calendar day across midnight and daylight saving", () => {
  assert.equal(
    localDate("2026-11-01T03:30:00Z", "America/Chicago"),
    "2026-10-31",
  );
  assert.equal(
    localDate("2026-11-01T08:30:00Z", "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(addDays("2026-10-31", 6), "2026-11-06");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(validTimeZone("Invalid/Zone"), "UTC");
});
test("only unfinished work becomes an action; overdue work precedes today and later work", () => {
  const state = data([
    record({ id: "future", data: { due_date: "2026-11-02" } }),
    record({ id: "today", data: { due_date: "2026-10-31", goal_id: "goal" } }),
    record({ id: "old", data: { due_date: "2026-10-30" } }),
    record({ id: "done", status: "completed" }),
    record({ id: "archived", status: "archived" }),
    record({
      id: "goal",
      kind: "goal",
      data: { current: 2, target: 10, due_date: "2026-11-05" },
    }),
  ]);
  const brief = buildDailyBrief(state);
  assert.deepEqual(
    brief.actions.map((a) => a.id),
    ["old", "today", "future"],
  );
  assert.equal(brief.actions[1].goalId, "goal");
  assert.equal(brief.completedToday, 1);
  assert.equal(brief.urgentCount, 1);
  assert.deepEqual(
    brief.upcoming.map((i) => i.id),
    ["task:today", "task:future", "goal:goal"],
  );
});
test("appointments near midnight stay on their local day and cancelled work isn't invented", () => {
  const state = data();
  state.appointments = [
    {
      id: "past",
      title: "Prior day",
      start_at: "2026-10-31T03:00:00Z",
      end_at: "2026-10-31T04:00:00Z",
      status: "booked",
    },
    {
      id: "in",
      title: "Next week",
      start_at: "2026-11-07T04:00:00Z",
      end_at: "2026-11-07T05:00:00Z",
      status: "booked",
    },
    {
      id: "out",
      title: "Too far",
      start_at: "2026-11-07T18:00:00Z",
      end_at: "2026-11-07T19:00:00Z",
      status: "booked",
    },
  ];
  assert.deepEqual(
    buildDailyBrief(state).upcoming.map((i) => i.id),
    ["appointment:in"],
  );
});
test("attention combines source decisions, blocked agents, and inquiries without inventing email urgency", () => {
  const state = data([record({ kind: "campaign", status: "needs_approval" })]);
  state.approvals = [
    {
      id: "approval",
      title: "Reply",
      summary: "Review reply",
      created_at: state.generatedAt,
    },
  ];
  state.counts.approvals = 1;
  state.work = [
    {
      id: "blocked",
      title: "Follow up",
      summary: "Connection needs attention",
      status: "blocked",
      updated_at: state.generatedAt,
    },
  ];
  state.counts.blockedWork = 1;
  const brief = buildDailyBrief(state);
  assert.equal(brief.decisions, 2);
  assert.equal(brief.attention[0].label, "Agent blocked");
  assert.equal(brief.urgentCount, 1);
  assert.equal(
    buildFocusBrief(state).sections.find((section) => section.key === "todo")
      ?.rows[0].key,
    "work:blocked",
  );
  assert.equal(buildDailyBrief(data()).attention.length, 0);
});
test("industry updates require a safe original source and progress is measured, bounded data", () => {
  const state = data([
    record({
      id: "unsafe",
      kind: "knowledge",
      data: { category: "Industry update", source_url: "javascript:alert(1)" },
    }),
    record({
      id: "no-source",
      kind: "knowledge",
      data: { category: "Industry update" },
    }),
    record({
      id: "source",
      kind: "knowledge",
      data: {
        category: "Industry update",
        source_url: "https://example.com/report",
      },
    }),
  ]);
  assert.deepEqual(
    buildDailyBrief(state).news.map((n) => n.id),
    ["source"],
  );
  assert.equal(safeSourceUrl("data:text/html,hello"), null);
  assert.equal(
    goalProgress(record({ kind: "goal", data: { current: 2, target: 8 } })),
    25,
  );
  assert.equal(
    goalProgress(record({ kind: "goal", data: { current: 15, target: 10 } })),
    100,
  );
  assert.equal(
    goalProgress(record({ kind: "goal", data: { current: 5, target: 0 } })),
    0,
  );
  assert.equal(
    RECORD_SCHEMA.safeParse({
      kind: "goal",
      title: "Goal",
      data: { target: 0 },
    }).success,
    false,
  );
  assert.equal(
    RECORD_SCHEMA.safeParse({
      kind: "job",
      title: "Action",
      data: { goal_id: "invalid" },
    }).success,
    false,
  );
  assert.equal(
    RECORD_SCHEMA.safeParse({
      kind: "knowledge",
      title: "Update",
      data: { category: "Industry update" },
    }).success,
    false,
  );
});


test("read-only mail is useful without agents, and delayed imports cannot report all clear", () => {
  const d=data();
  d.connectedData={apps:[{id:"google",name:"Google",account:"owner@example.com",provider:"google_workspace",status:"connected",paused:false,readOnly:true,lastSyncedAt:d.generatedAt,syncing:false,error:null}],messages:[{id:"mail",connectionId:"google",threadId:"thread",subject:"Availability?",from:"customer@example.com",preview:"",receivedAt:d.generatedAt,unread:true,inbox:true,account:"owner@example.com",href:"https://mail.google.com/mail/u/0/#all/thread",messageCount:1}],appointments:[],limited:false,errors:[],generatedAt:d.generatedAt};
  const focus=buildFocusBrief(d);
  assert.equal(focus.state,"planned");
  assert.equal(focus.sections.find(s=>s.key==="messages")?.rows[0].title,"Availability?");
  d.connectedData.apps[0].stale=true;
  assert.equal(buildFocusBrief(d).state,"incomplete");
  d.connectedData.apps[0].stale=false;d.connectedData.apps[0].lastSyncedAt=null;
  assert.equal(buildFocusBrief(d).state,"incomplete");
});

test("Today exposes conflicting duplicate money imports without claiming an amount due", () => {
  const snapshot = data();
  const invoice = { id: "invoice-a", connectionId: "stripe-a", externalId: "in_same", accountId: "acct_verified", account: "Business", provider: "stripe", number: "INV-1", status: "open", currency: "USD", totalMinor: 1200, amountDueMinor: 1200, amountPaidMinor: 0, dueAt: "2026-10-30T15:00:00Z", updatedAt: snapshot.generatedAt, href: "https://invoice.stripe.com/i/in_same" };
  snapshot.connectedData = { apps: [{ id: "stripe-a", name: "Stripe", account: "Business", provider: "stripe", status: "connected", paused: false, readOnly: true, lastSyncedAt: snapshot.generatedAt, syncing: false, error: null }], messages: [], appointments: [], payments: [], invoices: [invoice, { ...invoice, id: "invoice-b", connectionId: "stripe-b", status: "paid", amountDueMinor: 0, amountPaidMinor: 1200 }], limited: false, errors: [], generatedAt: snapshot.generatedAt };
  const brief = buildFocusBrief(snapshot);
  assert.equal(brief.state, "incomplete");
  assert.match(brief.title, /Money records need source review/);
  assert.equal(brief.sections.some((section) => section.key === "connected-invoices"), false);
  assert.equal(brief.sections.find((section) => section.key === "money-source-review")?.rows.length, 1);
});
