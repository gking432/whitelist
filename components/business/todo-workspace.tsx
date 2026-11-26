"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, RefreshCw } from "lucide-react";
import { localDate } from "@/lib/business/daily-brief";
import { crmSourceRunId } from "@/lib/crm/gateway-presentation";
import type { BusinessRecord } from "@/lib/business/types";
import type { SavedTask, TodoSnapshot } from "@/lib/business/todo-types";
import { AGENTS, type AgentKey } from "@/lib/agents/catalog";
import { BusinessDialog, RecordEditor } from "./record-editor";
import { RecordDetail } from "./record-detail";
import { OwnerAreaHeader, ownerButton, ownerQuietButton } from "./owner-ui";

export function TodoWorkspace({
  data,
  preview = false,
}: {
  data: TodoSnapshot;
  preview?: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"open" | "mine" | "agents" | "done">(
    "open",
  );
  const [editor, setEditor] = useState<{ record?: BusinessRecord } | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const key = useRef("");
  const locked = useRef(false);
  const busy = preview || saving || refreshing;
  const selected = data.workspace.records.find(
    (record) => record.id === selectedId,
  );
  const task = data.tasks.find((item) => item.id === taskId);
  const crmReviewRunId = crmSourceRunId(task?.source_crm_review_run_id);
  const today = localDate(data.generatedAt, data.timeZone);
  const allJobs = data.workspace.records.filter(
    (record) => record.kind === "job" && record.status !== "archived",
  );
  const jobs = allJobs.filter((record) =>
    filter === "done"
      ? record.status === "completed"
      : record.status !== "completed",
  );
  const tasks = data.tasks.filter((item) =>
    filter === "done" ? item.status === "done" : item.status === "open",
  );
  const assignments = data.work.filter((item) =>
    filter === "done"
      ? item.status === "completed"
      : item.status !== "completed",
  );
  const mine = [
    ...jobs.map((record) => ({
      id: record.id,
      title: record.title,
      due: String(record.data.due_date || ""),
      status: record.status,
      record,
      task: undefined as SavedTask | undefined,
    })),
    ...tasks.map((task) => ({
      id: task.id,
      title: task.title,
      due: task.due_at ? localDate(task.due_at, data.timeZone) : "",
      status: task.status,
      record: undefined as BusinessRecord | undefined,
      task,
    })),
  ].sort(
    (a, b) =>
      (a.due || "9999").localeCompare(b.due || "9999") ||
      a.title.localeCompare(b.title),
  );
  const hasAny =
    allJobs.length > 0 || data.tasks.length > 0 || data.work.length > 0;
  const hasCompleted =
    allJobs.some((record) => record.status === "completed") ||
    data.tasks.some((task) => task.status === "done") ||
    data.work.some((work) => work.status === "completed");
  const filterOptions = (
    [
      ["open", "Open"],
      ["mine", "For you"],
      ["agents", "Agents"],
      ["done", "Completed"],
    ] as const
  ).filter(
    ([value]) =>
      value === "open" ||
      value === filter ||
      (value === "done"
        ? hasCompleted
        : data.work.length > 0 &&
          (allJobs.length > 0 || data.tasks.length > 0)),
  );

  useEffect(() => {
    if (preview) return;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !locked.current &&
        !editor &&
        !selectedId &&
        !taskId
      )
        startRefresh(() => router.refresh());
    }, 30000);
    return () => clearInterval(timer);
  }, [router, editor, selectedId, taskId, preview]);

  function edit(record?: BusinessRecord) {
    key.current = crypto.randomUUID();
    setSelectedId(null);
    setError("");
    setEditor({ record });
  }
  async function mutate(input: { action: string; [key: string]: unknown }) {
    if (preview) return false;
    if (locked.current) return false;
    locked.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        input.action === "task_status"
          ? "/api/business/todo"
          : "/api/business/workspace",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || result.message || "Work could not be updated.",
        );
      setNotice(result.message || "Saved.");
      startRefresh(() => router.refresh());
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Work could not be updated.",
      );
      return false;
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  const statusTask = (task: SavedTask) =>
    mutate({
      action: "task_status",
      id: task.id,
      status: task.status === "done" ? "open" : "done",
      updatedAt: task.updated_at,
    });

  return (
    <div>
      <OwnerAreaHeader title="To-do">
        <button
          className={ownerQuietButton}
          aria-label="Refresh to-do"
          disabled={busy}
          onClick={() => startRefresh(() => router.refresh())}
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
        {data.workspace.canWrite ? (
          <button
            className={ownerQuietButton}
            disabled={busy}
            onClick={() => edit()}
          >
            <Plus className="size-3.5" />
            Add action
          </button>
        ) : null}
      </OwnerAreaHeader>
      {!preview ? <Link href="/client/customer-work" className="mt-4 inline-block text-xs text-slate-500 underline">Customer work & next decisions</Link> : null}
      {data.errors.length ? (
        <p role="alert" className="mt-6 text-sm text-amber-800">
          {data.errors.join(" ")}
        </p>
      ) : null}
      {error && !editor ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <span role="status" className="sr-only">
          {notice}
        </span>
      ) : null}
      {hasAny && filterOptions.length > 1 ? (
        <div className="mt-7 flex flex-wrap gap-5" aria-label="Filter work">
          {filterOptions.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              aria-pressed={value === filter}
              className={`min-h-9 text-xs ${value === filter ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {filter !== "agents" && mine.length ? (
        <section className="mt-8" aria-label="Your work">
          {filter === "open" && assignments.length ? (
            <h2 className="mb-3 text-xs text-slate-500">For you</h2>
          ) : null}
          <div className="divide-y divide-slate-100">
            {mine.map((item) => (
              <div
                key={`${item.record ? "record" : "task"}:${item.id}`}
                className="flex items-start gap-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() =>
                      item.record ? setSelectedId(item.id) : setTaskId(item.id)
                    }
                    className="break-words text-left text-sm text-slate-800 hover:text-slate-500"
                  >
                    {item.title}
                  </button>
                  {item.record?.data.assignee ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {String(item.record.data.assignee)}
                    </p>
                  ) : null}
                  {item.status === "blocked" ? (
                    <p className="mt-1 text-xs text-amber-700">Blocked</p>
                  ) : null}
                </div>
                {item.due ? (
                  <span
                    className={`shrink-0 text-xs ${item.due < today && filter !== "done" ? "text-amber-700" : "text-slate-500"}`}
                  >
                    {item.due < today && filter !== "done" ? "Overdue · " : ""}
                    {item.due === today
                      ? "Today"
                      : new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${item.due}T12:00:00Z`))}
                  </span>
                ) : null}
                {data.workspace.canWrite ? (
                  item.task ? (
                    <button
                      className={`${ownerQuietButton} -my-2`}
                      disabled={busy}
                      onClick={() => void statusTask(item.task!)}
                    >
                      {item.task.status === "done" ? (
                        "Reopen"
                      ) : (
                        <>
                          <Check className="size-3" />
                          Done
                        </>
                      )}
                    </button>
                  ) : item.record && item.record.status !== "completed" ? (
                    <button
                      className={`${ownerQuietButton} -my-2`}
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          action: "transition",
                          id: item.id,
                          revision: item.record!.revision,
                          transition:
                            item.record!.status === "in_progress"
                              ? "complete"
                              : "start",
                        })
                      }
                    >
                      {item.record.status === "in_progress" ? (
                        <>
                          <Check className="size-3" />
                          Done
                        </>
                      ) : (
                        "Start"
                      )}
                    </button>
                  ) : null
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {filter !== "mine" && assignments.length ? (
        <section className="mt-10" aria-label="Agent work">
          <h2 className="mb-3 text-xs text-slate-500">Agents</h2>
          <div className="divide-y divide-slate-100">
            {assignments.map((work) => (
              <div
                key={work.id}
                className="flex flex-wrap items-start justify-between gap-4 py-4"
              >
                <Link
                  href={
                    work.approval_id
                      ? "/client/approvals"
                      : work.conversation_id
                        ? `/client/messages?id=${encodeURIComponent(work.conversation_id)}`
                        : `/client/team#work-${work.id}`
                  }
                  className="min-w-0 flex-1 text-sm text-slate-800 hover:text-slate-500"
                >
                  {work.title}
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {AGENTS[work.agent_key as AgentKey]?.name || "Agent"}
                    {work.summary ? ` · ${work.summary}` : ""}
                  </span>
                </Link>
                <span
                  className={`text-[11px] ${work.status === "blocked" ? "text-amber-700" : "text-slate-500"}`}
                >
                  {work.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {data.limited ? (
        <p className="mt-8 text-xs text-slate-500">
          Showing recent work. Open the detailed tools for the full history.
        </p>
      ) : null}
      {editor ? (
        <RecordEditor
          kind="job"
          record={editor.record}
          records={data.workspace.records}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          onSave={(record, id, revision) =>
            mutate({
              action: "save_record",
              record,
              ...(id ? { id, revision } : {}),
              requestKey: key.current,
            })
          }
        />
      ) : null}
      {selected ? (
        <RecordDetail
          key={selected.id}
          record={selected}
          currency={data.workspace.profile.currency}
          busy={busy}
          canWrite={data.workspace.canWrite}
          onClose={() => setSelectedId(null)}
          onEdit={() => edit(selected)}
          onMutation={(input) =>
            mutate(input as { action: string; [key: string]: unknown })
          }
        />
      ) : null}
      {task ? (
        <BusinessDialog title={task.title} onClose={() => setTaskId(null)}>
          <div className="space-y-5">
            {task.source_invoice_record_id ? <Link href={`/client/money#invoice-${task.source_invoice_record_id}`} className="text-sm underline">Open invoice source review</Link> : null}
            {crmReviewRunId ? <Link href={`/client/apps?crmRun=${crmReviewRunId}`} className="text-sm underline">Review original work and HubSpot proposal</Link> : null}
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm leading-7">
                {task.description}
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              {task.status === "done" ? "Completed" : "Open"} · {task.priority}{" "}
              priority
              {task.due_at
                ? ` · Due ${new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(task.due_at))}`
                : ""}
            </p>
            {data.workspace.canWrite ? (
              <button
                className={ownerButton}
                disabled={busy}
                onClick={async () => {
                  if (await statusTask(task)) setTaskId(null);
                }}
              >
                {task.status === "done" ? "Reopen task" : "Complete task"}
              </button>
            ) : null}
          </div>
        </BusinessDialog>
      ) : null}
    </div>
  );
}
