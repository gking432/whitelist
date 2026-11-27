"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ChevronDown, Mail, MessageSquareText } from "lucide-react";
import { submitOwnerApproval } from "@/lib/approvals/owner-client";
import type { DailyBriefData } from "@/lib/business/daily-brief";
import { leadFollowUpContext, quietFor } from "@/lib/business/lead-followups";
import type { PreviewAction } from "./morning-work-queue";

type Approval = DailyBriefData["approvals"][number];
type Outcome = { state: "sent" | "skipped" | "failed" | "held"; message: string };

/**
 * Background sales work surfaces as one decision: the owner reads each drafted
 * follow-up with the reason the agent chose that lead, edits or skips any of
 * them, and sends the rest. Every send is still an individual approval with its
 * own delivery receipt.
 */
export function LeadFollowUpBatch({ approvals, now, preview, outbound, onPreviewAction, onDone }: {
  approvals: Approval[];
  outbound?: DailyBriefData["outbound"];
  now: string;
  preview: boolean;
  onPreviewAction?: (action: PreviewAction) => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(approvals.map((item) => [item.id, item.editable_content ?? ""])));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [openId, setOpenId] = useState<string | null>(approvals[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const pending = approvals.filter((item) => !outcomes[item.id] || outcomes[item.id].state === "failed");
  const channelLabel = approvals.every((item) => leadFollowUpContext(item).channel === "sms") ? "texts" : "emails";
  // Approving something that cannot go out would only hide it. Say so first and keep the drafts here.
  const blocked = preview ? null : [...new Set(approvals.map((item) => leadFollowUpContext(item).channel))]
    .map((channel) => outbound?.[channel]).find((state) => state && !state.ready) ?? null;
  const canSend = !blocked;

  async function decide(approval: Approval, resolution: "approve" | "reject"): Promise<Outcome> {
    const draft = drafts[approval.id] ?? "";
    if (resolution === "approve" && !draft.trim()) return { state: "failed", message: "Add a message before sending." };
    if (preview) {
      if (!onPreviewAction) return { state: "failed", message: "Sample is still loading." };
      onPreviewAction({ approvalId: approval.id, resolution, editedContent: draft });
      return resolution === "approve"
        ? { state: "sent", message: "Recorded as sent in this sample. No real email was sent." }
        : { state: "skipped", message: "Skipped. Nothing was sent." };
    }
    const form = new FormData();
    const edited = resolution === "approve" && draft.replace(/\r\n?/g, "\n") !== (approval.editable_content ?? "").replace(/\r\n?/g, "\n");
    form.set("resolution", resolution === "reject" ? "reject" : edited ? "edit_and_approve" : "approve");
    if (edited) form.set("edited_content", draft);
    const result = await submitOwnerApproval(approval.id, form);
    if (result.status !== "success") return { state: "failed", message: result.message || "Not sent. Try again." };
    if (resolution === "reject") return { state: "skipped", message: "Skipped. Nothing was sent." };
    // Approval is saved either way; only a confirmed delivery is called "sent".
    if (result.delivery === "sent") return { state: "sent", message: result.message || "Sent." };
    return { state: "held", message: result.message || "Approved, but not sent yet." };
  }

  async function run(items: Approval[], resolution: "approve" | "reject", key: string) {
    if (busy) return;
    setBusy(key);
    const settled: [string, Outcome][] = [];
    // One approval per request, in order: a lost receipt never resends anything.
    for (const item of items) {
      const outcome = await decide(item, resolution);
      settled.push([item.id, outcome]);
      setOutcomes((current) => ({ ...current, [item.id]: outcome }));
    }
    const results = Object.fromEntries(settled);
    setBusy(null);
    const sent = Object.values(results).filter((item) => item.state === "sent").length;
    const failed = Object.values(results).filter((item) => item.state === "failed").length;
    const skipped = Object.values(results).filter((item) => item.state === "skipped").length;
    const held = Object.values(results).filter((item) => item.state === "held").length;
    if (items.length > 1 || failed === 0) {
      const parts = [sent ? `${sent} sent` : null, held ? `${held} approved but not sent` : null, skipped ? `${skipped} skipped` : null, failed ? `${failed} need attention` : null].filter(Boolean);
      if (parts.length) onDone(`Follow-ups: ${parts.join(" · ")}.`);
    }
    const next = approvals.find((item) => !results[item.id] && !outcomes[item.id]);
    setOpenId(next?.id ?? null);
    if (!preview) router.refresh();
  }

  return <article data-followup-batch className="border-b border-slate-100 last:border-b-0">
    <div className="px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-violet-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-700">Sales agent · ready to send</p>
          <h3 className="mt-1 text-[15px] font-semibold leading-6 text-slate-900">
            {approvals.length === 1 ? "Follow up with 1 warm lead" : `Follow up with ${approvals.length} warm leads`}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            {approvals.length === 1
              ? <>This lead went quiet. The agent wrote a personal {channelLabel === "texts" ? "text" : "email"} from what they asked for before. Read it, edit it or skip it.</>
              : <>These leads went quiet. The agent wrote a personal {channelLabel === "texts" ? "text" : "email"} for each from what they asked for before. Read them, edit or skip any, then send.</>}
          </p>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {expanded ? "Hide" : "Read"}<ChevronDown aria-hidden="true" className={"size-4 transition-transform " + (expanded ? "rotate-180" : "")} />
        </button>
      </div>

      {blocked ? <p role="status" className="ml-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
        <span className="font-semibold">Not ready to send.</span> {blocked.reason}
      </p> : null}

      {expanded ? <ol id={listId} className="ml-5 mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
        {approvals.map((approval) => {
          const lead = leadFollowUpContext(approval);
          const outcome = outcomes[approval.id];
          const open = openId === approval.id && (!outcome || outcome.state === "failed");
          const quiet = quietFor(lead.lastContactAt, now);
          const Icon = lead.channel === "sms" ? MessageSquareText : Mail;
          const draftId = `${listId}-${approval.id}`;
          return <li key={approval.id} data-followup-item={approval.id} className="px-4 py-3">
            <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : approval.id)} disabled={!!outcome && outcome.state !== "failed"}
              className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-slate-900">
                  <Icon aria-hidden="true" className="size-3.5 text-slate-400" />{lead.name}
                  {lead.stage ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-600">{lead.stage.replaceAll("_", " ")}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{[quiet, lead.subject].filter(Boolean).join(" · ")}</span>
              </span>
              {outcome ? <span className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium " + (outcome.state === "sent" ? "bg-emerald-50 text-emerald-700" : outcome.state === "skipped" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800")}>
                {outcome.state === "sent" ? "Sent" : outcome.state === "skipped" ? "Skipped" : outcome.state === "held" ? "Approved · not sent" : "Not sent"}
              </span> : <ChevronDown aria-hidden="true" className={"mt-1 size-4 shrink-0 text-slate-400 transition-transform " + (open ? "rotate-180" : "")} />}
            </button>
            {outcome ? <p role="status" className={"mt-1 text-xs " + (outcome.state === "failed" || outcome.state === "held" ? "text-amber-800" : "text-slate-500")}>{outcome.message}</p> : null}
            {open ? <div className="mt-3 space-y-3">
              {lead.reason || lead.history ? <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700">
                {lead.reason ? <p><span className="font-semibold">Why now:</span> {lead.reason}</p> : null}
                {lead.history ? <p className={lead.reason ? "mt-1" : ""}><span className="font-semibold">Before:</span> {lead.history}</p> : null}
              </div> : null}
              <div>
                <label htmlFor={draftId} className="text-xs font-medium text-slate-600">
                  {lead.channel === "sms" ? "Text" : "Email"} to {lead.to ?? lead.name}{lead.subject ? <> · <span className="font-normal">{lead.subject}</span></> : null}
                </label>
                <textarea id={draftId} rows={5} value={drafts[approval.id] ?? ""} disabled={!!busy}
                  onChange={(event) => setDrafts((current) => ({ ...current, [approval.id]: event.target.value }))}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void run([approval], "approve", approval.id)} disabled={!!busy || !canSend}
                  className="inline-flex min-h-9 items-center rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {busy === approval.id ? "Sending…" : "Send this one"}
                </button>
                <button type="button" onClick={() => void run([approval], "reject", approval.id)} disabled={!!busy}
                  className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Skip</button>
              </div>
            </div> : null}
          </li>;
        })}
      </ol> : null}

      <div className="ml-5 mt-4 flex flex-wrap items-center gap-3">
        {canSend ? <button type="button" data-primary-action onClick={() => void run(pending, "approve", "all")} disabled={!!busy || pending.length === 0}
          className="inline-flex min-h-10 items-center rounded-lg bg-[#1f3a2d] px-4 text-sm font-semibold text-white hover:bg-[#183024] disabled:opacity-50">
          {busy === "all" ? "Sending…" : pending.length === approvals.length ? `Send all ${pending.length}` : `Send remaining ${pending.length}`}
        </button> : <Link href="/client/apps" data-primary-action className="inline-flex min-h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          {channelLabel === "texts" ? "Connect texting to send" : "Connect email to send"}
        </Link>}
        <span className="text-xs text-slate-500">
          {preview ? "Sample only. Nothing is sent." : canSend ? `Each ${channelLabel === "texts" ? "text" : "email"} goes from your connected account. Replies come back here.` : "The drafts wait here until sending is set up."}
        </span>
      </div>
    </div>
  </article>;
}
