import assert from "node:assert/strict";
import test from "node:test";
import { orderMorningApprovals, orderMorningQueueRows, overlappingAppointments } from "../lib/business/morning-queue.ts";
import type { FocusRow } from "../lib/business/focus-brief.ts";
import type { DailyAction } from "../lib/business/daily-brief.ts";

const row = (key: string, kind: FocusRow["kind"], detail = key): FocusRow => ({
  key, kind, title: key, detail, label: kind,
});
const action = (id: string, dueDate: string, priority = "normal"): DailyAction => ({
  id, title: id, dueDate, priority, status: "open", source: "tasks", goalId: "", description: "",
});

test("morning queue ranks owner urgency and actual due dates ahead of section order", () => {
  const rows = [
    row("appointment:later", "appointment"),
    row("action:later", "action"),
    row("connected-invoice:stripe:past", "invoice"),
    row("action:today", "action"),
    row("action:urgent", "action"),
  ];
  const ordered = orderMorningQueueRows(rows, {
    today: "2026-11-26",
    timeZone: "America/Chicago",
    actions: [action("later", "2026-12-01"), action("today", "2026-11-26"), action("urgent", "2026-12-05", "urgent")],
    appointments: [{ id: "later", title: "Later", start_at: "2026-11-27T20:00:00Z", end_at: "2026-11-27T21:00:00Z", status: "booked" }],
    connectedInvoices: [{ id: "past", connectionId: "stripe", status: "past_due", dueAt: "2026-11-20T18:00:00Z" }] as never,
    savedInvoices: [],
  });
  assert.deepEqual(ordered.map((item) => item.key), [
    "action:urgent", "connected-invoice:stripe:past", "action:today", "appointment:later", "action:later",
  ]);
});

test("morning queue shows an action or appointment once and preserves the first source detail", () => {
  const firstAction = row("action:a", "action", "Overdue from the owner brief");
  const firstAppointment = row("appointment:b", "appointment", "Booked from the calendar");
  const ordered = orderMorningQueueRows([
    firstAction, firstAppointment, row("action:a", "action", "Later generic copy"),
    row("appointment:b", "appointment", "Later generic copy"),
  ], {
    today: "2026-11-26", timeZone: "America/Chicago",
    actions: [action("a", "2026-11-20")],
    appointments: [{ id: "b", title: "Booked", start_at: "2026-11-27T20:00:00Z", end_at: "2026-11-27T21:00:00Z", status: "booked" }],
    connectedInvoices: [], savedInvoices: [],
  });
  assert.equal(ordered.length, 2);
  assert.equal(ordered[0], firstAction);
  assert.equal(ordered[1], firstAppointment);
});

test("near-term scheduling and customer replies outrank older approvals without a deadline", () => {
  const approvals = [
    { id: "generic", title: "Generic", summary: "", created_at: "2026-11-01T00:00:00Z", type: "crm_change" },
    { id: "customer", title: "Customer", summary: "", created_at: "2026-11-20T00:00:00Z", type: "customer_message" },
    { id: "next-month", title: "Next month", summary: "", created_at: "2026-11-18T00:00:00Z", type: "appointment_booking", proposed_payload: { slot: { start_iso: "2026-12-20T14:00:00Z" } } },
    { id: "tomorrow", title: "Tomorrow", summary: "", created_at: "2026-11-25T00:00:00Z", type: "appointment_booking", proposed_payload: { slot: { start_iso: "2026-11-27T14:00:00Z" } } },
  ];
  assert.deepEqual(orderMorningApprovals(approvals, "2026-11-26T12:00:00Z").map((approval) => approval.id), [
    "tomorrow", "customer", "next-month", "generic",
  ]);
});

test("calendar preview excludes the moved appointment and its imported mirror from conflicts", () => {
  const appointments = [
    { id: "native-1", title: "Current native", start_at: "2026-11-27T14:00:00Z", end_at: "2026-11-27T15:00:00Z", status: "booked" },
    { id: "imported:canonical-1", title: "Current mirror", start_at: "2026-11-27T14:00:00Z", end_at: "2026-11-27T15:00:00Z", status: "booked" },
    { id: "other", title: "Another booking", start_at: "2026-11-27T14:30:00Z", end_at: "2026-11-27T15:30:00Z", status: "booked" },
  ];
  const slot = { start_iso: "2026-11-27T14:30:00Z", end_iso: "2026-11-27T15:30:00Z" };
  assert.deepEqual(overlappingAppointments(appointments, slot, ["native-1", "imported:canonical-1"]).map((item) => item.id), ["other"]);
});
