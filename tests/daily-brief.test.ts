import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
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
      workspaceScopeKey: "owner:client",
      profileRevision: null,
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

test("urgent customer work stays first with links to its source while ordinary invoices remain visible", () => {
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
  const attention = brief.sections.find((section) => section.key === "attention");
  const invoices = brief.sections.find((section) => section.key === "invoices");
  const todo = brief.sections.find((section) => section.key === "todo");
  assert.equal(brief.sections[0].key, "attention");
  assert.equal(attention?.rows[0].href, "/client/messages?id=message");
  assert.ok(attention?.links?.some((link) => link.href === "/client/messages"));
  assert.ok(attention?.links?.some((link) => link.href === "/client/todo"));
  assert.deepEqual(
    invoices?.rows.map((row) => row.recordId),
    ["invoice"],
  );
  assert.equal(invoices?.rows[0].label, "$125.00");
  assert.match(invoices?.rows[0].detail || "", /Draft/);
  assert.equal(attention?.rows.length, 4);
  assert.equal(attention?.remaining, 4);
  assert.equal(todo, undefined);
  const keys = brief.sections.flatMap((section) => section.rows.map((row) => row.key));
  assert.equal(new Set(keys).size, keys.length);
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
  const focus = buildFocusBrief(state);
  assert.equal(focus.sections[0].key, "attention");
  assert.deepEqual(focus.sections[0].rows.map((row) => row.key), ["approval:approval", "record:record", "work:blocked"]);
  assert.equal(focus.sections.some((section) => section.key === "todo"), false);
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

test("an available owner decision stays prominent when another source errors or is importing", () => {
  const snapshot = data();
  snapshot.approvals = [{ id: "decision", title: "Review actual decision", summary: "Saved approval", created_at: snapshot.generatedAt }];
  snapshot.counts.approvals = 1;
  snapshot.errors = ["Calendar could not be checked"];
  const focus = buildFocusBrief(snapshot);
  assert.equal(focus.state, "attention");
  assert.equal(focus.title, "1 decision needs you.");
  assert.match(focus.description, /couldn’t be checked/);
  assert.equal(focus.link?.href, "/client/business/approvals");
  assert.equal(focus.sections[0].rows[0].key, "approval:decision");
});

test("future-only booked appointments are represented without inventing cancelled or proposed bookings", () => {
  const snapshot = data();
  const future = { id: "future", title: "Recorded consultation", start_at: "2026-11-02T20:30:00Z", end_at: "2026-11-02T21:30:00Z", status: "booked", sourceAccount: "Exact calendar", sourceHref: "https://calendar.google.com/calendar/event?eid=fixture" };
  snapshot.appointments = [{ ...future, id: "cancelled", title: "Cancelled appointment", status: "cancelled", start_at: "2026-11-01T18:00:00Z" }, { ...future, id: "proposal", status: "proposed", start_at: "2026-11-01T19:00:00Z" }, future];
  const focus = buildFocusBrief(snapshot);
  assert.equal(focus.state, "planned");
  assert.equal(focus.upcomingAppointment?.title, future.title);
  assert.match(focus.upcomingAppointment?.when ?? "", /Mon, Nov 2.*2:30 PM/);
  assert.equal(focus.upcomingAppointment?.account, "Exact calendar");
  assert.equal(focus.upcomingAppointment?.href, future.sourceHref);
  assert.equal(focus.sections.some((section) => section.key === "appointments"), false);
  snapshot.appointments = snapshot.appointments.filter((appointment) => appointment.status !== "booked");
  assert.equal(buildFocusBrief(snapshot).upcomingAppointment, null);
  snapshot.appointments = [
    { ...future, title: "Later instant", start_at: "2026-11-02T11:00:00-06:00", end_at: "2026-11-02T12:00:00-06:00" },
    { ...future, title: "Earlier instant", start_at: "2026-11-02T16:00:00Z", end_at: "2026-11-02T17:00:00Z" },
  ];
  assert.equal(buildFocusBrief(snapshot).upcomingAppointment?.title, "Earlier instant");
});
test("future all-day dates remain date-only and upcoming context does not replace today's decisions", () => {
  const snapshot = data();
  snapshot.appointments = [{ id: "all-day", title: "Recorded all-day visit", start_at: "2026-11-02", end_at: "2026-11-03", allDay: true, status: "booked" }];
  snapshot.approvals = [{ id: "urgent", title: "Current decision", summary: "Needs owner review", created_at: snapshot.generatedAt }];
  snapshot.counts.approvals = 1;
  const focus = buildFocusBrief(snapshot);
  assert.equal(focus.state, "attention"); assert.equal(focus.title, "1 decision needs you.");
  assert.equal(focus.upcomingAppointment?.when, "Mon, Nov 2 · All day");
  assert.equal(focus.sections[0].rows[0].key, "approval:urgent");
});
test("the rendered calm brief shows a real upcoming booking and omits empty or generic footer decoration", () => {
  const snapshot = data();
  snapshot.appointments = [{ id: "future", title: "Future booking shown", start_at: "2026-11-02T20:30:00Z", end_at: "2026-11-02T21:30:00Z", status: "booked" }];
  const full = buildFocusBrief(snapshot), empty = buildFocusBrief(data());
  const code = `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {FocusBriefCard}=require('./components/business/focus-brief-card.tsx');console.log(JSON.stringify([${JSON.stringify(full)},${JSON.stringify(empty)}].map(brief=>renderToStaticMarkup(React.createElement(FocusBriefCard,{brief,greeting:'Good morning.'})))));`;
  const html = JSON.parse(execFileSync(resolve("node_modules/.bin/tsx"), ["-e", code], { encoding: "utf8", timeout: 15000 })) as string[];
  assert.match(html[0], /data-upcoming-appointment/); assert.match(html[0], /Future booking shown/); assert.match(html[0], /Mon, Nov 2.*2:30 PM/);
  assert.doesNotMatch(html[1], /data-upcoming-appointment|Coming up|Your connected work will appear here/);
});

test("the blue docket keeps next week out of Later this week", () => {
  const snapshot = data();
  const sunday = { id: "sunday", title: "Sunday booking", start_at: "2026-11-01T20:00:00Z", end_at: "2026-11-01T21:00:00Z", status: "booked" };
  const monday = { id: "monday", title: "Monday booking", start_at: "2026-11-02T20:00:00Z", end_at: "2026-11-02T21:00:00Z", status: "booked" };
  const render = (state: DailyBriefData) => {
    const props = { brief: buildFocusBrief(state), upcoming: buildDailyBrief(state).upcoming, today: localDate(state.generatedAt, state.timeZone), timeZone: state.timeZone };
    const code = "const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {FocusBriefCard}=require('./components/business/focus-brief-card.tsx');console.log(renderToStaticMarkup(React.createElement(FocusBriefCard," + JSON.stringify(props) + ")));";
    return execFileSync(resolve("node_modules/.bin/tsx"), ["-e", code], { encoding: "utf8", timeout: 15000 });
  };
  snapshot.appointments = [sunday, monday];
  const withSunday = render(snapshot);
  assert.match(withSunday, /Sunday booking/);
  assert.doesNotMatch(withSunday, /Monday booking/);

  snapshot.appointments = [monday];
  const afterWeek = render(snapshot);
  assert.match(afterWeek, /Later this week.*Nothing else scheduled this week.*Next appointment.*Monday booking/s);
});

test("ISO all-day events use business-local dates for both today's list and future context", () => {
  const snapshot = data();
  snapshot.appointments = [
    { id: "iso-today", title: "All day today", start_at: "2026-10-31T05:00:00Z", end_at: "2026-11-01T05:00:00Z", allDay: true, status: "booked" },
    { id: "iso-future", title: "ISO future all day", start_at: "2026-11-02T06:00:00Z", end_at: "2026-11-03T06:00:00Z", allDay: true, status: "booked" },
  ];
  const focus = buildFocusBrief(snapshot);
  assert.equal(focus.title, "An all-day event is on your calendar.");
  assert.deepEqual(focus.sections.find((section) => section.key === "appointments")?.rows.map((row) => [row.key, row.label]), [["appointment:iso-today", "All day"]]);
  assert.equal(focus.upcomingAppointment?.title, "ISO future all day");
  assert.equal(focus.upcomingAppointment?.when, "Mon, Nov 2 · All day");
  snapshot.appointments = snapshot.appointments.slice(0, 1);
  assert.equal(buildFocusBrief(snapshot).upcomingAppointment, null);
});
test("invalid all-day and timed dates are skipped without crashing or inventing upcoming work", () => {
  const snapshot = data();
  snapshot.appointments = [
    { id: "bad-date", title: "Invalid calendar date", start_at: "2027-02-30", end_at: "2027-03-03", allDay: true, status: "booked" },
    { id: "bad-iso", title: "Invalid ISO date", start_at: "2027-02-30T06:00:00Z", end_at: "2027-03-03T06:00:00Z", allDay: true, status: "booked" },
    { id: "bad-time", title: "Invalid time", start_at: "not-a-date", end_at: "2027-03-03T06:00:00Z", status: "booked" },
    { id: "bad-end", title: "Invalid ending", start_at: "2027-03-02T06:00:00Z", end_at: "not-a-date", allDay: true, status: "booked" },
  ];
  const focus = buildFocusBrief(snapshot);
  assert.equal(focus.upcomingAppointment, null);
  assert.equal(focus.rows.length, 0);
  assert.equal(focus.sections.some((section) => section.key === "appointments"), false);
});
