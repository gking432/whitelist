"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import {
  buildDailyBrief,
  goalProgress,
  safeSourceUrl,
  validTimeZone,
  type DailyBriefData,
} from "@/lib/business/daily-brief";
import type { BusinessRecord, RecordKind } from "@/lib/business/types";
import { RecordEditor } from "./record-editor";
import { RecordDetail } from "./record-detail";
import { ConnectedDataRefresh } from "./connected-data-refresh";
import { FocusBriefCard } from "./focus-brief-card";
import { MorningWorkQueue, type PreviewAction } from "./morning-work-queue";
import { MorningMetricCard } from "./morning-metric-card";
import { HandledForYouCard } from "./handled-for-you-card";
import { buildFocusBrief, type FocusRow } from "@/lib/business/focus-brief";
import { orderMorningQueueRows } from "@/lib/business/morning-queue";
import { orderDailySections, recommendWorkspaceFocus } from "@/lib/business/workspace-preferences";
import { WorkspacePreferencesPanel } from "./workspace-preferences-panel";

const quietButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40";
const sectionHeading = "text-[13px] font-medium text-slate-500";

function dateLabel(date: string, today: string) {
  if (date === today) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function DailyBrief({
  data,
  preview = false,
  onPreviewAction,
  onPreviewAppointmentChange,
}: {
  data: DailyBriefData;
  preview?: boolean;
  onPreviewAction?: (action: PreviewAction) => void;
  onPreviewAppointmentChange?: (appointmentId: string, slot: { start_iso: string; end_iso: string }) => void;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [editor, setEditor] = useState<{
    kind: RecordKind;
    record?: BusinessRecord;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goalFilter, setGoalFilter] = useState<string | null>(null);
  const [allGoals, setAllGoals] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const requestKey = useRef("");
  const addMenu = useRef<HTMLDetailsElement>(null);
  const busy = preview || saving || refreshing;
  const brief = buildDailyBrief(data);
  const focus = buildFocusBrief(data, Number.POSITIVE_INFINITY);
  const inlineApprovals = preview || data.canResolveApprovals ? data.approvals : [];
  const hasInlineApprovals = inlineApprovals.length > 0;
  const sections = orderDailySections(focus.sections, data.personalization?.preferences)
    .map((section) => hasInlineApprovals && section.key === "attention" ? {
      ...section,
      rows: section.rows.filter((row) => !row.key.startsWith("approval:")),
      links: section.links?.filter((link) => link.href !== "/client/business/approvals"),
    } : section)
    .filter((section) => section.rows.length || section.links?.length);
  if (hasInlineApprovals && focus.link?.href === "/client/business/approvals") {
    focus.link = null;
    focus.rows = focus.rows.filter((row) => !row.key.startsWith("approval:"));
  }
  const recommendation = recommendWorkspaceFocus(focus.sections, data.personalization?.activity ?? []);
  if (preview && focus.link)
    focus.link = { ...focus.link, href: focus.link.href === "/client/todo"
      ? "/preview/todo" : focus.link.href === "/client/apps"
        ? "/preview/apps" : "/preview" };
  const workspace = data.workspace;
  const selected = workspace.records.find((record) => record.id === selectedId);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: data.timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(data.generatedAt)),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: data.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(data.generatedAt));
  const visibleGoals = allGoals ? brief.goals : brief.goals.slice(0, 5);
  const queueRows = orderMorningQueueRows(preview && data.previewQueueRows ? data.previewQueueRows : [
    ...sections.flatMap((section) => section.rows),
    ...brief.actions.map((action): FocusRow => ({
      key: "action:" + action.id,
      title: action.title,
      detail: action.description || (action.dueDate ? "Due " + action.dueDate : "Saved action"),
      label: action.status === "blocked" ? "Blocked" : "To-do",
      kind: "action",
      ...(action.source === "workspace" ? { recordId: action.id } : { href: "/client/todo" }),
    })),
    ...brief.upcoming.filter((item) => item.id.startsWith("appointment:") && item.date > brief.today).map((item): FocusRow => ({
      key: item.id,
      title: item.title,
      detail: item.label + " · " + item.date,
      label: "Upcoming",
      kind: "appointment",
      href: item.href,
    })),
  ], {
    today: brief.today,
    timeZone: validTimeZone(data.timeZone),
    actions: brief.actions,
    appointments: data.appointments,
    connectedInvoices: data.connectedData?.invoices ?? [],
    savedInvoices: workspace.records.filter((record) => record.kind === "invoice"),
  });

  function openEditor(kind: RecordKind, record?: BusinessRecord) {
    if (addMenu.current) addMenu.current.open = false;
    setSelectedId(null);
    setFeedback(null);
    requestKey.current = crypto.randomUUID();
    setEditor({ kind, record });
  }
  async function mutate(input: unknown) {
    if (preview) return false;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/business/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || result.message || "The change could not be saved.",
        );
      setFeedback({ error: false, text: result.message || "Saved." });
      startRefresh(() => router.refresh());
      return true;
    } catch (error) {
      setFeedback({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "The change could not be saved. Try again.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 text-left">
      {!preview ? <ConnectedDataRefresh /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          data-preview-date={preview ? "" : undefined}
          className="text-xs text-slate-500"
        >
          {date}
        </p>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button
            onClick={() => startRefresh(() => router.refresh())}
            disabled={busy}
            className={quietButton}
            aria-label="Refresh daily brief"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
          {workspace.canWrite ? (
            <details ref={addMenu} className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900">
                <Plus className="size-3.5" />
                Add
              </summary>
              <div className="absolute right-0 top-full z-30 min-w-40 rounded-xl border border-slate-100 bg-white p-1.5 shadow-lg shadow-slate-900/5">
                {(
                  [
                    ["job", "Action"],
                    ["goal", "Goal"],
                    ["knowledge", "Saved update"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => {
                      setGoalFilter(null);
                      openEditor(kind);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          {data.personalization ? <WorkspacePreferencesPanel snapshot={data.personalization} recommendation={recommendation} preview={preview} /> : null}
        </div>
      </div>

      <h1 className="mt-5 text-[28px] font-semibold leading-tight tracking-[-0.045em] text-slate-950 sm:text-[34px]">{greeting}{data.displayName ? ", " + data.displayName : ""}.</h1>
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <div className="order-1 min-w-0 lg:order-none"><FocusBriefCard brief={focus} upcoming={brief.upcoming} today={brief.today} timeZone={validTimeZone(data.timeZone)} /></div>
        <div className="order-3 min-w-0 lg:order-none"><MorningMetricCard key={data.workspace.workspaceScopeKey} data={data} preview={preview} /></div>
        <div className={"order-2 min-w-0 lg:order-none " + (calendarExpanded ? "lg:col-span-2" : "")}><MorningWorkQueue key={data.workspace.workspaceScopeKey} approvals={inlineApprovals} appointments={data.appointments} tasks={data.tasks} canWriteTasks={data.workspace.canWrite && !preview} customers={data.connectedData?.customers ?? []} timeZone={validTimeZone(data.timeZone)} rows={queueRows} scopeKey={data.workspace.workspaceScopeKey} now={data.generatedAt} onOpenRecord={setSelectedId} moreDecisionCount={hasInlineApprovals ? Math.max(0, data.counts.approvals - inlineApprovals.length) : 0} preview={preview} onPreviewAction={onPreviewAction} onRescheduleAppointment={onPreviewAppointmentChange} onCalendarOpenChange={setCalendarExpanded} /></div>
        <div className="order-4 min-w-0 lg:order-none"><HandledForYouCard data={data} preview={preview} /></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
        {!preview ? <Link href="/client/customer-work" className="hover:text-slate-800">Customer work</Link> : null}
        <Link
          href={preview ? "/preview/manager" : "/client/manager"}
          className="hover:text-slate-800"
        >
          Talk to your manager
        </Link>
        {data.connectedData?.invoices?.length || data.connectedData?.payments?.length ? <Link href={preview ? "/preview/money" : "/client/money"} className="hover:text-slate-800">Open money records</Link> : null}
        <Link
          href={preview ? "/preview/todo" : "/client/todo"}
          className="hover:text-slate-800"
        >
          Open To-do
        </Link>
      </div>
      {data.errors.length ? (
        <details className="mt-6 text-xs text-amber-800">
          <summary className="min-h-11 cursor-pointer py-3">What couldn’t be checked</summary>
          <p role="alert" className="mt-2 leading-6">
            {data.errors.join(" ")} Refresh to try again.
          </p>
        </details>
      ) : null}
      {feedback?.error && !editor ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {feedback.text}
        </p>
      ) : null}
      {feedback && !feedback.error ? (
        <span role="status" className="sr-only">
          {feedback.text}
        </span>
      ) : null}

      <div className="mt-12 space-y-10">
        {visibleGoals.length ? (
          <details id="goals">
            <summary className={`${sectionHeading} min-h-11 cursor-pointer py-3`}>
              Goals · {brief.goals.length}
            </summary>
            <div className="mt-3 divide-y divide-slate-100">
              {visibleGoals.map((goal) => {
                const progress = goalProgress(goal);
                const next = brief.actions.find(
                  (action) => action.goalId === goal.id,
                );
                return (
                  <div key={goal.id} className="py-5">
                    <div className="flex items-start justify-between gap-5">
                      <button
                        onClick={() => setSelectedId(goal.id)}
                        className="min-h-11 break-words text-left text-sm text-slate-800 hover:text-slate-500"
                      >
                        {goal.title}
                      </button>
                      <span className="shrink-0 text-xs text-slate-500">
                        {Number(goal.data.current).toLocaleString()} /{" "}
                        {Number(goal.data.target).toLocaleString()}{" "}
                        {String(goal.data.unit || "")}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={goal.title}
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-3 h-0.5 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className="h-full rounded-full bg-slate-400"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                      {next ? (
                        <button
                          className="min-h-11 text-left text-xs text-slate-500 hover:text-slate-700"
                          onClick={() =>
                            next.source === "workspace"
                              ? setSelectedId(next.id)
                              : router.push("/client/todo")
                          }
                        >
                          Next: {next.title}
                        </button>
                      ) : workspace.canWrite ? (
                        <button
                          className="min-h-11 text-xs text-slate-500 hover:text-slate-700"
                          disabled={busy}
                          onClick={() => {
                            setGoalFilter(goal.id);
                            openEditor("job");
                          }}
                        >
                          Add an action
                        </button>
                      ) : null}
                      {goal.data.due_date ? (
                        <span className="text-[11px] text-slate-500">
                          {dateLabel(String(goal.data.due_date), brief.today)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {brief.goals.length > 5 ? (
              <button
                className={quietButton}
                onClick={() => setAllGoals(!allGoals)}
              >
                {allGoals ? "Show less" : "More goals"}
              </button>
            ) : null}
          </details>
        ) : null}

        {brief.news.length ? (
          <details>
            <summary className={`${sectionHeading} min-h-11 cursor-pointer py-3`}>
              Worth a look · {brief.news.length}
            </summary>
            <div className="mt-3 divide-y divide-slate-100">
              {brief.news.slice(0, 3).map((item) => (
                <article key={item.id} className="py-4">
                  <a
                    href={safeSourceUrl(item.data.source_url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-start gap-2 text-sm text-slate-800 hover:text-slate-500"
                  >
                    {item.title}
                    <ExternalLink className="mt-1 size-3 shrink-0 text-slate-300" />
                  </a>
                  {item.body ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-6 text-slate-500">
                      {item.body}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
                    <span>
                      {String(
                        item.data.publisher ||
                          new URL(safeSourceUrl(item.data.source_url)!)
                            .hostname,
                      )}
                    </span>
                    {workspace.canWrite ? (
                      <button
                        onClick={() => openEditor("knowledge", item)}
                        disabled={busy}
                        className="min-h-11 px-2 hover:text-slate-700"
                        aria-label={`Edit ${item.title}`}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {editor ? (
        <RecordEditor
          key={editor.record?.id || editor.kind}
          kind={editor.kind}
          record={editor.record}
          initialData={
            editor.kind === "knowledge"
              ? { category: "Industry update" }
              : editor.kind === "job" && goalFilter
                ? { goal_id: goalFilter }
                : undefined
          }
          records={workspace.records}
          busy={busy}
          error={feedback?.error ? feedback.text : undefined}
          onClose={() => setEditor(null)}
          onSave={(record, id, revision) =>
            mutate({
              action: "save_record",
              record,
              ...(id ? { id, revision } : {}),
              requestKey: requestKey.current,
            })
          }
        />
      ) : null}
      {selected ? (
        <RecordDetail
          key={selected.id}
          record={selected}
          currency={workspace.profile.currency}
          busy={busy}
          canWrite={workspace.canWrite}
          onClose={() => setSelectedId(null)}
          onEdit={() => openEditor(selected.kind, selected)}
          onMutation={mutate}
        />
      ) : null}
    </div>
  );
}
