"use client";

import { useEffect, useMemo, useState } from "react";
import { DailyBriefShell } from "@/components/business/daily-brief-shell";
import { DailyBrief } from "@/components/business/daily-brief";
import { TodoWorkspace } from "@/components/business/todo-workspace";
import { ConversationInbox } from "@/components/conversations/inbox";
import { BusinessManagerChat } from "@/components/agents/manager-chat";
import { SampleSourceArea } from "@/components/business/sample-source-area";
import { SampleMonthlyReport } from "@/components/business/sample-monthly-report";
import type { PreviewAction } from "@/components/business/morning-work-queue";
import { OWNER_AREAS, previewAreaHref } from "@/lib/business/owner-navigation";
import { SampleCustomers } from "@/components/business/sample-customers";
import {
  applySamplePreviewEvent,
  createSamplePreview,
  parseSamplePreviewHistory,
  sampleConversationSnapshot,
  sampleManagerSnapshot,
  sampleTodoSnapshot,
  type SamplePreviewEvent,
} from "@/lib/business/sample-preview";

const STORAGE_KEY = "meridian:sample-preview-actions:v1";
const customerSummaries: Record<string, string> = {
  "Jayden Ellis": "New inquiry. Agreed to Friday at 2:30 PM after a 2:00 PM calendar conflict.",
  "Jamie Morgan": "Returning client. Asked to discuss the next phase of the brand project.",
  "Maya Patel": "Active client with a launch planning project.",
  "Sam Rivera": "New inquiry. Sent a website brief for review.",
};

export function SamplePreviewApp({ area }: { area: string }) {
  const [history, setHistory] = useState<SamplePreviewEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const data = useMemo(() => history.reduce(applySamplePreviewEvent, createSamplePreview()), [history]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setHistory(parseSamplePreviewHistory(sessionStorage.getItem(STORAGE_KEY))); }
      catch { setHistory([]); }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); }
    catch { /* The sample remains usable without browser storage. */ }
  }, [history, ready]);

  function recordAction(action: PreviewAction) {
    setHistory((current) => current.some((item) => "approvalId" in item && item.approvalId === action.approvalId)
      ? current : [...current, action]);
  }
  function recordCalendarEdit(appointmentId: string, slot: { start_iso: string; end_iso: string }) {
    setHistory((current) => [...current, { kind: "calendar_edit", appointmentId, slot }]);
  }
  function resetSample() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      const prefix = "meridian:morning-acknowledged:v1:public-sample-workspace-v1";
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    } catch { /* Browser storage may be unavailable. */ }
    setHistory([]);
    setResetVersion((value) => value + 1);
  }

  const navigation = OWNER_AREAS.map((item) => ({
    ...item,
    href: previewAreaHref(item.href),
  }));
  const jaydenBooking = data.appointments.find((item) => item.id === "sample-jayden-confirmed");
  const jaydenOffer = data.work.find((item) => item.id === "sample-decision-sample-jayden-booking" && item.title.startsWith("Offered"));
  const jaydenSummary = jaydenBooking
    ? `New inquiry. Friday appointment confirmed for ${new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(jaydenBooking.start_at))}.`
    : jaydenOffer ? "New inquiry. A revised appointment time was sent; waiting for Jayden’s reply."
    : customerSummaries["Jayden Ellis"];
  const customers = (data.connectedData?.customers ?? []).map((customer) => ({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    summary: customer.name === "Jayden Ellis" ? jaydenSummary : customerSummaries[customer.name] ?? "Sample customer record.",
  }));
  const content = area === "report" ? (
    <SampleMonthlyReport data={data} />
  ) : area === "customers" ? (
    <SampleCustomers key={history.length} data={data} conversations={sampleConversationSnapshot(data)}
      summaries={Object.fromEntries(customers.map((customer) => [customer.name, customer.summary]))} />
  ) : area === "messages" ? (
    <ConversationInbox key={history.length} preview timeZone={data.timeZone} initialSnapshot={sampleConversationSnapshot(data)} />
  ) : area === "todo" ? (
    <TodoWorkspace key={history.length} preview data={sampleTodoSnapshot(data)} />
  ) : area === "manager" ? (
    <BusinessManagerChat key={history.length} preview initialSnapshot={sampleManagerSnapshot(data)} />
  ) : area === "apps" || area === "calendar" || area === "money" ? (
    <SampleSourceArea area={area} data={data} />
  ) : (
    <DailyBrief key={resetVersion} preview data={data} onPreviewAction={ready ? recordAction : undefined} onPreviewAppointmentChange={ready ? recordCalendarEdit : undefined} />
  );

  return (
    <DailyBriefShell
      preview
      brandName="Meridian"
      clientName={data.workspace.clientName}
      email=""
      navigation={navigation}
      previewCustomers={customers}
      banner={
        <div className="border-b border-blue-100 bg-[#f2f6ff] px-5 py-3 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="text-xs leading-5 text-blue-950"><span className="font-semibold">Sample workspace · Feb 24, 2027.</span> Explore the app with fictional records. No accounts are connected, and actions here do not send messages, book real appointments, or make payments.</p>
            <div className="flex items-center gap-4">
              <button type="button" onClick={resetSample} disabled={!ready} className="min-h-9 text-xs font-medium text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50">Reset sample</button>
            </div>
          </div>
        </div>
      }
    >
      <div data-public-review data-preview-area={area || "today"}>{content}</div>
    </DailyBriefShell>
  );
}
