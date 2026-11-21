"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS, WORK_LABELS } from "@/lib/agents/catalog";
import type { TeamSnapshot, WorkStatus } from "@/lib/agents/types";

const STATUS: Record<WorkStatus, string> = {
  queued: "Queued",
  running: "Working",
  waiting_children: "Following delegated work",
  waiting_approval: "Needs approval",
  waiting_external: "Waiting for progress",
  completed: "Completed",
  blocked: "Needs attention",
  cancelled: "Stopped",
};
const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40";
const field = "mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm";

export function AgentTeam({
  initialSnapshot,
  clientName,
}: {
  initialSnapshot: TeamSnapshot;
  clientName: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [request, setRequest] = useState("");
  const [filter, setFilter] = useState("active");
  const inFlight = useRef(false);
  // Preserve the request key on network errors: retrying cannot create duplicate work.
  const pendingRequest = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    try {
      const response = await fetch("/api/agents/team", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Team could not be refreshed.");
      if (!inFlight.current) setSnapshot(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Team could not be refreshed.");
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function mutate(input: Record<string, unknown>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/agents/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Change could not be saved.");
      setSnapshot(data.snapshot);
      setNotice(data.message);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Change could not be saved. You can safely retry.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function assign(input: Record<string, unknown>) {
    const fingerprint = JSON.stringify(input);
    if (pendingRequest.current?.fingerprint !== fingerprint)
      pendingRequest.current = { fingerprint, key: crypto.randomUUID() };
    const saved = await mutate({ ...input, key: pendingRequest.current.key });
    if (saved) pendingRequest.current = null;
    return saved;
  }
  const active = snapshot.settings?.status === "active";
  const disabled = busy || !snapshot.canWrite;
  const visibleWork = snapshot.work.filter(
    (w) =>
      filter === "all" ||
      (filter === "attention"
        ? ["blocked", "waiting_approval", "waiting_external"].includes(w.status)
        : !["completed", "cancelled"].includes(w.status)),
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{clientName}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Your agent team
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Assign work once. Your team shares business records, delegates the
            next steps, and keeps the work open until the outcome is recorded.
          </p>
        </div>
        <Link href="/client/manager" className={button}>
          Chat with business manager
        </Link>
        <Link href="/client/conversations" className={button}>
          Customer conversations
        </Link>
        <Link href="/client/mobile" className={button}>
          Open simple view
        </Link>
      </header>
      <div
        role="status"
        aria-live="polite"
        className={
          notice ? "rounded-lg border bg-secondary p-3 text-sm" : "sr-only"
        }
      >
        {notice}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {!snapshot.canWrite && (
        <p className="rounded-lg border p-3 text-sm">
          You have read-only access to this team.
        </p>
      )}
      {!snapshot.aiConfigured && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          AI is not connected in this environment. You can ask the business
          manager for status or a standard review. Open-ended planning and AI
          message drafting need AI configured. Inventory checks, purchasing
          proposals, approvals, and recorded progress can run.
        </p>
      )}
      <section
        aria-labelledby="team-controls"
        className="rounded-xl border bg-card p-5"
      >
        <div className="flex items-center gap-3">
          <h2 id="team-controls" className="font-semibold">
            Team controls
          </h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs">
            {active ? "Active" : "Paused"}
          </span>
        </div>
        <form
          key={[
            active,
            snapshot.settings?.marketing_enabled,
            snapshot.settings?.administration_enabled,
            snapshot.settings?.conversations_enabled,
            snapshot.settings?.scheduling_enabled,
            snapshot.settings?.sales_enabled,
            snapshot.settings?.operations_enabled,
            snapshot.settings?.scheduled_reviews,
            snapshot.settings?.lead_stale_hours,
          ].join(":")}
          className="mt-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            await mutate({
              action: "settings",
              status: data.get("active") ? "active" : "paused",
              marketing_enabled: !!data.get("marketing"),
              administration_enabled: !!data.get("administration"),
              conversations_enabled: !!data.get("conversations"),
              scheduling_enabled: !!data.get("scheduling"),
              sales_enabled: !!data.get("sales"),
              operations_enabled: !!data.get("operations"),
              scheduled_reviews: !!data.get("scheduled"),
              lead_stale_hours: Number(data.get("hours")),
            });
          }}
        >
          <fieldset
            disabled={disabled}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={active}
                className="size-4"
              />
              Activate team
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="marketing"
                defaultChecked={snapshot.settings?.marketing_enabled ?? false}
                className="size-4"
              />
              Marketing campaigns
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="administration"
                defaultChecked={
                  snapshot.settings?.administration_enabled ?? false
                }
                className="size-4"
              />
              Operations & administration
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="conversations"
                defaultChecked={
                  snapshot.settings?.conversations_enabled ?? false
                }
                className="size-4"
              />
              Customer conversations
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scheduling"
                defaultChecked={snapshot.settings?.scheduling_enabled ?? false}
                className="size-4"
              />
              Appointment scheduling
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sales"
                defaultChecked={snapshot.settings?.sales_enabled ?? false}
                className="size-4"
              />
              Sales follow-up
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="operations"
                defaultChecked={snapshot.settings?.operations_enabled ?? false}
                className="size-4"
              />
              Inventory & purchasing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scheduled"
                defaultChecked={snapshot.settings?.scheduled_reviews ?? false}
                className="size-4"
              />
              Review every hour
            </label>
          </fieldset>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              Consider leads inactive after (hours)
              <input
                name="hours"
                type="number"
                min={1}
                max={720}
                required
                defaultValue={snapshot.settings?.lead_stale_hours ?? 24}
                disabled={disabled}
                className={field}
              />
            </label>
            <button
              disabled={disabled}
              className={`${button} bg-primary text-primary-foreground`}
            >
              Save team settings
            </button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Pausing stops new agent work and unsent agent follow-ups. Messages
            already accepted by a provider and orders already placed remain in
            effect. Background reviews require the application worker to be
            running.
          </p>
        </form>
      </section>
      <section
        aria-labelledby="assign-work"
        className="rounded-xl border bg-card p-5"
      >
        <h2 id="assign-work" className="font-semibold">
          What should your team work on?
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {(
            [
              "marketing_campaign",
              "administration_review",
              "conversation_review",
              "sales_review",
              "operations_review",
              "owner_briefing",
            ] as const
          ).map((kind) => (
            <button
              key={kind}
              className={button}
              disabled={
                disabled ||
                !active ||
                (kind === "marketing_campaign" &&
                  !snapshot.settings?.marketing_enabled) ||
                (kind === "administration_review" &&
                  !snapshot.settings?.administration_enabled) ||
                (kind === "conversation_review" &&
                  !snapshot.settings?.conversations_enabled) ||
                (kind === "sales_review" &&
                  !snapshot.settings?.sales_enabled) ||
                (kind === "operations_review" &&
                  !snapshot.settings?.operations_enabled)
              }
              onClick={() => void assign({ action: "review", kind })}
            >
              {WORK_LABELS[kind]}
            </button>
          ))}
        </div>
        <form
          className="mt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await assign({ action: "request", request })) setRequest("");
          }}
        >
          <label className="text-sm" htmlFor="business-request">
            Describe a customer service, sales, inventory, or progress request
          </label>
          <textarea
            id="business-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            minLength={5}
            maxLength={2000}
            required
            rows={3}
            className={field}
            placeholder="Check neglected leads and flag anything that needs my attention."
            disabled={disabled || !active || !snapshot.aiConfigured}
          />
          <button
            className={`${button} mt-3`}
            disabled={
              disabled ||
              !active ||
              !snapshot.aiConfigured ||
              request.trim().length < 5
            }
          >
            Assign to business manager
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Customer conversations share verified records across channels. Sales,
          service, and scheduling prepare actions for your approval. Calendar
          bookings use real availability. Supplier ordering remains an owner
          handoff.
        </p>
      </section>
      <section aria-labelledby="roles">
        <h2 id="roles" className="mb-3 font-semibold">
          Who handles the work
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(AGENTS).map(([key, agent]) => (
            <article key={key} className="rounded-xl border bg-card p-4">
              <h3 className="font-medium">{agent.name}</h3>
              <p className="mt-1 text-xs text-primary">{agent.mode}</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {agent.responsibility}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Reports to{" "}
                {agent.reportsTo ? AGENTS[agent.reportsTo].name : "you"}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="work-list">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="work-list" className="font-semibold">
            Assignments
          </h2>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="work-filter">
              Filter assignments
            </label>
            <select
              id="work-filter"
              className="rounded-lg border bg-background px-3 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">Active work</option>
              <option value="attention">Needs attention</option>
              <option value="all">All recent work</option>
            </select>
            <button
              className={button}
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        </div>
        {!visibleWork.length ? (
          <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
            {snapshot.work.length
              ? "No assignments match this view."
              : "No assignments yet. Activate the departments you need, then start a review of your business records."}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleWork.map((work) => (
              <article
                id={`work-${work.id}`}
                key={work.id}
                className="scroll-mt-6 rounded-xl border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-primary">
                      {AGENTS[work.agent_key]?.name ?? "Agent"}
                    </p>
                    <h3 className="mt-1 font-medium">{work.title}</h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${work.status === "blocked" ? "bg-amber-100 text-amber-950" : "bg-secondary"}`}
                  >
                    {STATUS[work.status]}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {work.summary ||
                    "Saved and waiting for the background worker."}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {work.conversation_id && (
                    <Link
                      className="underline"
                      href={`/client/conversations?id=${work.conversation_id}`}
                    >
                      Customer conversation
                    </Link>
                  )}
                  {work.parent_id && (
                    <a
                      href={`#work-${work.parent_id}`}
                      className="underline"
                      onClick={() => setFilter("all")}
                    >
                      Parent assignment
                    </a>
                  )}
                  {work.approval_id && (
                    <Link className="underline" href="/client/approvals">
                      Message approval
                    </Link>
                  )}
                  {work.result_record_id && (
                    <Link
                      className="underline"
                      href={`/client/business/${work.kind === "marketing_campaign" ? "marketing" : work.kind === "administration_review" ? "operations" : "purchasing"}?record=${work.result_record_id}`}
                    >
                      {work.kind === "marketing_campaign"
                        ? "Campaign & approval"
                        : work.kind === "administration_review"
                          ? "Operations brief"
                          : "Purchase & receipt"}
                    </Link>
                  )}
                  {work.source_lead_id && (
                    <Link className="underline" href="/client/crm">
                      Customer records
                    </Link>
                  )}
                  {work.source_record_id && (
                    <Link
                      className="underline"
                      href={`/client/business/operations?record=${work.source_record_id}`}
                    >
                      Inventory record
                    </Link>
                  )}
                </div>
                {snapshot.canWrite &&
                  !["completed", "cancelled"].includes(work.status) && (
                    <div className="mt-4 flex gap-2">
                      {work.status === "blocked" && (
                        <button
                          className={button}
                          disabled={busy || !active}
                          onClick={() =>
                            void mutate({
                              action: "control",
                              id: work.id,
                              revision: work.revision,
                              transition: "retry",
                            })
                          }
                        >
                          Recheck saved work
                        </button>
                      )}
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void mutate({
                            action: "control",
                            id: work.id,
                            revision: work.revision,
                            transition: "cancel",
                          })
                        }
                      >
                        Stop assignment
                      </button>
                    </div>
                  )}
              </article>
            ))}
          </div>
        )}
        {snapshot.hasMore && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the 100 most recently updated assignments. Older work
            remains saved.
          </p>
        )}
      </section>
      <details className="rounded-xl border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium">
          Recent team activity
        </summary>
        <ol className="mt-4 space-y-3">
          {snapshot.events.map((event) => (
            <li key={event.id} className="border-t pt-3 text-sm">
              <p>{event.summary}</p>
              <time
                dateTime={event.created_at}
                className="text-xs text-muted-foreground"
              >
                {new Date(event.created_at)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 16)}{" "}
                UTC
              </time>
            </li>
          ))}
        </ol>
        {!snapshot.events.length && (
          <p className="mt-4 text-sm text-muted-foreground">
            Activity appears when work is assigned.
          </p>
        )}
      </details>
    </div>
  );
}
