"use client";

import { InvoiceFollowupPreview } from "@/components/approvals/invoice-followup-preview";
import { CrmGatewayPreview } from "@/components/approvals/crm-gateway-preview";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  ExternalLink,
  Grid2X2,
  HelpCircle,
  MoreHorizontal,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { resolveMobileBusinessDecision } from "@/app/client/mobile/actions";
import { resolveClientApproval } from "@/app/client/approvals/actions";
import { ApprovalResolutionForm } from "@/components/approvals/approval-resolution-form";
import { CalendarChangePreview } from "@/components/approvals/calendar-change-preview";
import { ExternalActionPreview } from "@/components/approvals/external-action-preview";
import type { PortalBranding } from "@/lib/clients/portal";
import type {
  MobileBusinessData,
  MobileCustomerApproval,
} from "@/lib/business/mobile-types";
import type { BusinessRecord } from "@/lib/business/types";
import type { FormState } from "@/lib/forms/state";
import { appShortcut, connectionLabel } from "@/lib/business/app-shortcuts";
import { displayMoney } from "@/lib/business/rules";
import { BusinessDialog } from "./record-editor";
import { KIND_LABELS, RECORD_FIELDS } from "./record-fields";
import { buildMobileSourceSummary } from "@/lib/business/mobile-summary";
import { validTimeZone } from "@/lib/business/daily-brief";
import { ConnectedMoney } from "./connected-money";
import { ConnectedIntakeRecords } from "./connected-intake";

type Tab = "approvals" | "apps" | "recent";
type Selection =
  | { kind: "business"; record: BusinessRecord }
  | { kind: "customer"; approval: MobileCustomerApproval };
const touchButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition disabled:opacity-50";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
const getOnline = () => navigator.onLine;
const serverOnline = () => true;
const when = (date: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(date));

function businessConsequence(kind: BusinessRecord["kind"]) {
  if (kind === "purchase")
    return "Approving clears this purchase request. It does not place an order or spend money.";
  if (kind === "campaign")
    return "Approving clears this content for use. It does not send or publish it.";
  return "Approving saves your decision. Sending or completing this work happens separately.";
}

export function MobileOwnerView({
  data,
  clientName,
  timeZone,
  branding,
  isTestAccount,
}: {
  data: MobileBusinessData;
  clientName: string;
  timeZone: string;
  branding: PortalBranding;
  isTestAccount: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("approvals");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const online = useSyncExternalStore(subscribeOnline, getOnline, serverOnline);
  const count = data.pendingBusinessCount + data.pendingCustomerCount;
  const attentionCount = count + data.agentAttentionCount;
  const unavailable = !online || Boolean(data.error);
  const sourceSummary = buildMobileSourceSummary(data.connectedData, data.connectedDataError);
  const refresh = () => startRefresh(() => router.refresh());
  function chooseTab(next: Tab) {
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // Refresh on return to the app and while it is visible. Do not replace an
  // open decision: the owner approves the exact revision they reviewed.
  useEffect(() => {
    const update = () => {
      if (
        !selection &&
        !more &&
        navigator.onLine &&
        document.visibilityState === "visible"
      ) {
        startRefresh(() => router.refresh());
      }
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [router, selection, more]);

  const decisions = [
    ...data.pendingRecords.map((record) => ({
      id: record.id,
      title: record.title,
      summary: record.body,
      label: KIND_LABELS[record.kind],
      created: record.created_at,
      selection: { kind: "business", record } as Selection,
    })),
    ...data.customerApprovals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      summary:
        approval.summary || "Review the proposed action before it goes ahead.",
      label:
        approval.type === "external_action"
          ? "Connected app"
          : "Customer request",
      created: approval.created_at,
      selection: { kind: "customer", approval } as Selection,
    })),
  ].sort((a, b) => a.created.localeCompare(b.created));
  const recent = [
    ...data.events.map((event) => ({
      id: event.id,
      title: event.summary,
      detail: "",
      date: event.created_at,
    })),
    ...data.recentCustomerApprovals.map((approval) => {
      const delivery = [...(approval.action_jobs ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      )[0];
      const deliveryDetail = delivery
        ? ` Delivery: ${delivery.status.replaceAll("_", " ")}${delivery.outcome_detail ? ` — ${delivery.outcome_detail}` : ""}.`
        : approval.status === "rejected"
          ? " The proposal was declined."
          : " No delivery confirmation recorded.";
      return {
        id: approval.id,
        title: approval.title,
        detail: `Decision: ${approval.status.replaceAll("_", " ")}.${deliveryDetail}`,
        date: approval.resolved_at || approval.created_at,
      };
    }),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return (
    <div className="min-h-dvh bg-secondary/30 pb-[calc(6rem_+_env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-xl">
        <header className="flex items-center justify-between gap-3 px-5 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary text-lg font-semibold text-primary-foreground">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="size-full bg-card object-contain"
                />
              ) : (
                branding.productName.slice(0, 1)
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {branding.productName}
                {isTestAccount ? " · Test business" : ""}
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {clientName}
              </p>
            </div>
          </div>
          <button
            onClick={() => setMore(true)}
            aria-label="Help and more options"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-card"
          >
            <MoreHorizontal className="size-5" />
          </button>
        </header>

        <main id="owner-content" className="space-y-5 px-5">
          <Link
            href="/client/manager"
            className="flex min-h-12 items-center justify-between rounded-2xl border bg-card px-4 text-sm font-semibold text-primary"
          >
            Chat with your business manager
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
          <Link href="/client/customer-work" className="inline-block text-xs text-muted-foreground underline">Customer work & next decisions</Link>
          {unavailable ? (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              {!online ? (
                <>
                  <WifiOff className="mb-2 size-5" />
                  You’re offline. Reconnect and refresh before making a
                  decision.
                </>
              ) : (
                data.error
              )}
            </div>
          ) : null}
          {notice ? (
            <div
              role="status"
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"
            >
              {notice}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3 py-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Your business, at a glance
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {tab === "approvals"
                  ? "Needs you"
                  : tab === "apps"
                    ? "Your apps"
                    : "Recent activity"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {tab === "approvals"
                  ? "A few decisions. Then back to your day."
                  : tab === "apps"
                    ? "The tools your business runs on."
                    : "See what happened and what’s still being delivered."}
              </p>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing || !online}
              aria-label="Refresh business"
              className="mt-6 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {tab === "approvals" ? (
            <>
              <section
                className={`rounded-3xl p-5 ${count && !unavailable ? "bg-primary text-primary-foreground" : "border bg-card"}`}
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${count && !unavailable ? "bg-white/15" : "bg-primary/8 text-primary"}`}
                  >
                    <CheckCheck className="size-6" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {unavailable
                        ? "Let’s check your connection"
                        : count
                          ? `${count} ${count === 1 ? "decision" : "decisions"} waiting`
                          : data.agentAttentionCount
                            ? "Your team needs attention"
                            : "You’re all caught up"}
                    </h2>
                    <p
                      className={`mt-1 text-sm leading-5 ${count && !unavailable ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                    >
                      {unavailable
                        ? "The list below may be out of date."
                        : count
                          ? "Review the details. You make the call."
                          : data.agentAttentionCount
                            ? "Check the work waiting below."
                            : "New requests will appear here."}
                    </p>
                  </div>
                </div>
              </section>
              {data.agentAttention.length > 0 && (
                <section
                  aria-label="Agent work needing attention"
                  className="space-y-3"
                >
                  <h2 className="px-1 text-sm font-semibold">From your team</h2>
                  {data.agentAttention.map((work) => (
                    <Link
                      key={work.id}
                      href={
                        work.conversation_id
                          ? `/client/conversations?id=${work.conversation_id}`
                          : work.result_record_id
                            ? `/client/business/${work.kind === "marketing_campaign" ? "marketing" : work.kind === "administration_review" ? "operations" : "purchasing"}?record=${work.result_record_id}`
                            : `/client/team#work-${work.id}`
                      }
                      className="block rounded-3xl border bg-card p-5"
                    >
                      <span className="text-xs font-medium text-amber-800">
                        {work.status === "blocked"
                          ? "Needs attention"
                          : "Waiting for progress"}
                      </span>
                      <h3 className="mt-2 break-words font-semibold">
                        {work.title}
                      </h3>
                      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                        {work.summary}
                      </p>
                      <span className="mt-3 block text-sm font-semibold text-primary">
                        Review work →
                      </span>
                    </Link>
                  ))}
                  {data.agentAttentionCount > data.agentAttention.length && (
                    <Link
                      href="/client/team"
                      className="block px-2 text-sm underline"
                    >
                      See all {data.agentAttentionCount} assignments needing
                      attention
                    </Link>
                  )}
                </section>
              )}
              <div className="space-y-3">
                {decisions.map((item) => (
                  <button
                    key={`${item.selection.kind}:${item.id}`}
                    onClick={() => {
                      setNotice("");
                      setSelection(item.selection);
                    }}
                    className="w-full rounded-3xl border bg-card p-5 text-left shadow-sm transition hover:border-primary/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                        {item.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Review needed
                      </span>
                    </div>
                    <h3 className="mt-3 break-words font-semibold leading-6">
                      {item.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-muted-foreground">
                      {item.summary || "Open to review the details."}
                    </p>
                    <span className="mt-4 flex items-center justify-between border-t pt-3 text-sm font-semibold text-primary">
                      Review decision
                      <ChevronRight className="size-4" />
                    </span>
                  </button>
                ))}
              </div>
              {count > decisions.length ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  Showing the oldest {decisions.length} requests first. More
                  will appear as you clear these.
                </p>
              ) : null}
              {!count && !unavailable ? (
                <button
                  onClick={() => chooseTab("apps")}
                  className="flex w-full items-center justify-between rounded-2xl border bg-card p-5 text-sm font-medium"
                >
                  Open one of your apps
                  <ArrowUpRight className="size-4" />
                </button>
              ) : null}
              <p className="px-2 pb-2 text-center text-xs leading-6 text-muted-foreground">
                Updates while this page is open. Phone push notifications aren’t
                enabled yet.
              </p>
            </>
          ) : null}

          {tab === "approvals" && sourceSummary.visible ? (
            <button
              type="button"
              onClick={() => chooseTab("apps")}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-5 text-left"
            >
              <span className="min-w-0"><span className="block text-sm font-medium">Money & form inquiries</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">{sourceSummary.label}</span></span>
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          ) : null}

          {tab === "apps" ? (
            <div className="space-y-3">
              {sourceSummary.visible ? (
                <details className="rounded-3xl border bg-card p-5">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Money & form inquiries
                    <span className="mt-1 block text-xs font-normal leading-6 text-muted-foreground">{sourceSummary.label}</span>
                  </summary>
                  <div className="mt-5 space-y-6">
                    {data.connectedDataError ? <p role="alert" className="text-xs leading-6 text-amber-800">{data.connectedDataError}</p> : null}
                    {sourceSummary.notices.length ? <p className="text-xs leading-6 text-amber-800">{sourceSummary.notices.join(" ")}</p> : null}
                    {sourceSummary.generatedAt ? <p className="text-[11px] leading-6 text-muted-foreground">Loaded {when(sourceSummary.generatedAt, validTimeZone(timeZone))}. Statuses reflect imported records; verify current details in the source app before acting.</p> : null}
                    {data.connectedData ? <>
                      <ConnectedMoney data={data.connectedData} timeZone={timeZone} compact />
                      <ConnectedIntakeRecords data={data.connectedData} timeZone={timeZone} compact />
                    </> : null}
                    {!sourceSummary.hasRecords && !data.connectedDataError ? <p className="text-sm leading-7 text-muted-foreground">No money or form records have been imported into this view yet. Source status may still be incomplete.</p> : null}
                    <div className="flex flex-wrap gap-5 text-xs"><Link href="/client/apps" className="underline">Check connected apps</Link><Link href="/client" className="underline">Open Today</Link></div>
                  </div>
                </details>
              ) : null}
              {data.connections.length ? (
                data.connections.map((connection) => {
                  const url = appShortcut(connection);
                  const live =
                    connection.status === "connected" &&
                    connection.runtime_mode === "live";
                  return (
                    <section
                      key={connection.id}
                      className="rounded-3xl border bg-card p-5"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-lg font-semibold">
                          {(
                            connection.provider?.display_name ||
                            connection.display_name
                          ).slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h2 className="break-words font-semibold">
                            {connection.display_name}
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {connection.provider?.display_name}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 flex items-center gap-2 text-xs">
                        <span
                          className={`size-2 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`}
                        />
                        {connectionLabel(connection)}
                      </p>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${touchButton} mt-4 w-full border bg-background`}
                        >
                          Open{" "}
                          {connection.provider?.display_name ||
                            connection.display_name}
                          <ExternalLink className="size-4 shrink-0" />
                        </a>
                      ) : (
                        <p className="mt-4 text-xs leading-6 text-muted-foreground">
                          {connection.provider?.provider_key ===
                          "northstar_web_chat"
                            ? "This connection manages chat on your website. Your agency can help with setup."
                            : "Your agency manages this connection. Ask them for its app link."}
                        </p>
                      )}
                    </section>
                  );
                })
              ) : (
                <section className="rounded-3xl border bg-card px-6 py-10 text-center">
                  <Grid2X2 className="mx-auto size-8 text-primary" />
                  <h2 className="mt-4 font-semibold">
                    Your tools, together here
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Once your agency connects your calendar, messages, or other
                    tools, you can open them from here.
                  </p>
                </section>
              )}
              <p className="px-2 text-xs leading-6 text-muted-foreground">
                App links open in a new tab. Use your business account to sign
                in. Connection status does not confirm that every automation is
                running.
              </p>
              <button
                onClick={() => setMore(true)}
                className={`${touchButton} w-full border bg-card`}
              >
                <HelpCircle className="size-4" />
                Need help with an app?
              </button>
            </div>
          ) : null}

          {tab === "recent" ? (
            <section className="overflow-hidden rounded-3xl border bg-card">
              {recent.length ? (
                <ol className="divide-y">
                  {recent.map((item) => (
                    <li key={item.id} className="flex gap-3 p-5">
                      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                        <Clock3 className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium leading-6">
                          {item.title}
                        </p>
                        {item.detail ? (
                          <p className="mt-1 break-words text-xs leading-6 text-muted-foreground">
                            {item.detail}
                          </p>
                        ) : null}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {when(item.date, timeZone)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="p-8 text-center">
                  <Clock3 className="mx-auto size-7 text-primary" />
                  <h2 className="mt-4 font-semibold">
                    Your activity will appear here
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Decisions and completed steps leave a record you can check.
                  </p>
                </div>
              )}
            </section>
          ) : null}
        </main>

        <nav
          aria-label="Simple business navigation"
          className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-xl grid-cols-3 border-t bg-card/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-lg"
        >
          {(
            [
              { key: "approvals", label: "Needs you", Icon: Bell },
              { key: "apps", label: "Apps", Icon: Grid2X2 },
              { key: "recent", label: "Recent", Icon: Clock3 },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => chooseTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium ${tab === key ? "bg-primary/8 text-primary" : "text-muted-foreground"}`}
            >
              <span className="relative">
                <Icon className="size-5" />
                {key === "approvals" && attentionCount > 0 ? (
                  <span className="absolute -right-3 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
                    {attentionCount > 99 ? "99+" : attentionCount}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {more ? (
        <BusinessDialog
          title="Here when you need us"
          onClose={() => setMore(false)}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Your business is supported by {branding.partnerName}.
            </p>
            {branding.supportEmail ? (
              <a
                href={`mailto:${branding.supportEmail}`}
                className={`${touchButton} w-full border`}
              >
                {branding.supportLabel || "Email your agency"}
                <ArrowUpRight className="size-4" />
              </a>
            ) : null}
            {branding.supportPhone ? (
              <a
                href={`tel:${branding.supportPhone.replace(/[^+\d]/g, "")}`}
                className={`${touchButton} w-full border`}
              >
                Call {branding.supportPhone}
              </a>
            ) : null}
            {!branding.supportEmail && !branding.supportPhone ? (
              <Link
                href="/client/support"
                className={`${touchButton} w-full border`}
              >
                Contact your agency
              </Link>
            ) : null}
            {data.canManageConnections ? (
              <Link
                href="/client/activate"
                className={`${touchButton} w-full border`}
              >
                Connect your assistants
                <ArrowUpRight className="size-4" />
              </Link>
            ) : null}
            <Link
              href="/client/team"
              className={`${touchButton} w-full border`}
            >
              View your agent team
            </Link>
            <Link
              href="/client/business/home"
              className={`${touchButton} w-full bg-primary text-primary-foreground`}
            >
              Open full workspace
              <ArrowUpRight className="size-4" />
            </Link>
            <p className="text-xs leading-6 text-muted-foreground">
              You can stay in this simple view for everyday decisions. The full
              workspace is there whenever you need more detail.
            </p>
          </div>
        </BusinessDialog>
      ) : null}

      {selection?.kind === "business" ? (
        <BusinessDecision
          record={selection.record}
          currency={data.currency}
          canDecide={data.canDecideBusiness && !unavailable}
          onClose={() => setSelection(null)}
          onSaved={(message) => {
            setSelection(null);
            setNotice(message);
            refresh();
          }}
        />
      ) : null}
      {selection?.kind === "customer" ? (
        <CustomerDecision
          approval={selection.approval}
          canDecide={data.canDecideCustomer && !unavailable}
          onClose={() => setSelection(null)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

function BusinessDecision({
  record,
  currency,
  canDecide,
  onClose,
  onSaved,
}: {
  record: BusinessRecord;
  currency: string;
  canDecide: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [busy, startDecision] = useTransition();
  const [error, setError] = useState("");
  const total =
    record.kind === "purchase" || record.kind === "quote"
      ? Number(record.data.quantity || 0) *
          Number(record.data.unit_cost ?? record.data.unit_price ?? 0) +
        Number(record.data.shipping || 0)
      : null;
  const decide = (resolution: "approve" | "reject") =>
    startDecision(async () => {
      setError("");
      try {
        const result = await resolveMobileBusinessDecision({
          id: record.id,
          revision: record.revision,
          resolution,
        });
        if (result.status === "success")
          onSaved(result.message || "Decision saved.");
        else setError(result.message || "Your decision could not be saved.");
      } catch {
        setError(
          "Connection interrupted. Close and refresh to check whether your decision was saved.",
        );
      }
    });
  return (
    <BusinessDialog title={record.title} onClose={busy ? () => {} : onClose}>
      <div className="space-y-5">
        <span className="text-xs font-medium text-muted-foreground">
          {KIND_LABELS[record.kind]}
        </span>
        {total !== null ? (
          <div className="rounded-2xl bg-primary/5 p-4">
            <p className="text-xs text-muted-foreground">Expected total</p>
            <p className="mt-1 text-3xl font-semibold">
              {displayMoney(total, currency)}
            </p>
          </div>
        ) : null}
        <dl className="space-y-3">
          {RECORD_FIELDS[record.kind]
            .filter(
              (field) =>
                field.key !== "product_id" &&
                record.data[field.key] !== "" &&
                record.data[field.key] != null,
            )
            .map((field) => (
              <div key={field.key}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                  {String(record.data[field.key])}
                </dd>
              </div>
            ))}
        </dl>
        {record.body ? (
          <section className="rounded-2xl border bg-background/50 p-4">
            <h3 className="text-xs font-semibold text-muted-foreground">
              {record.kind === "campaign" ? "Content to approve" : "Details"}
            </h3>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
              {record.body}
            </p>
          </section>
        ) : null}
        <p className="rounded-2xl bg-secondary/60 p-4 text-sm leading-6">
          {businessConsequence(record.kind)}
        </p>
        {error ? (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {error}
          </p>
        ) : null}
        {canDecide ? (
          <div className="sticky -bottom-6 grid grid-cols-2 gap-3 border-t bg-card py-4">
            <button
              disabled={busy}
              onClick={() => decide("reject")}
              className={`${touchButton} border`}
            >
              Decline
            </button>
            <button
              disabled={busy}
              onClick={() => decide("approve")}
              className={`${touchButton} bg-primary text-primary-foreground`}
            >
              <Check className="size-4" />
              {busy ? "Saving…" : "Approve"}
            </button>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Decisions are unavailable with your current access or connection.
          </p>
        )}
      </div>
    </BusinessDialog>
  );
}

function CustomerDecision({
  approval,
  canDecide,
  onClose,
  onSaved,
}: {
  approval: MobileCustomerApproval;
  canDecide: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  async function resolve(
    previous: FormState,
    form: FormData,
  ): Promise<FormState> {
    try {
      const result = await resolveClientApproval(approval.id, previous, form);
      if (result.status === "success") onSaved();
      return result;
    } catch {
      return {
        status: "error",
        message:
          "Connection interrupted. Close and refresh to check the decision before retrying.",
      };
    }
  }
  return (
    <BusinessDialog title={approval.title} onClose={onClose}>
      <div className="space-y-5 [&_button]:min-h-12 [&_input]:text-base [&_textarea]:text-base">
        {approval.summary ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {approval.summary}
          </p>
        ) : null}
        {approval.type === "external_action" ? (
          <ExternalActionPreview payload={approval.proposed_payload} />
        ) : null}
        {approval.type === "appointment_change" ? <CalendarChangePreview payload={approval.proposed_payload} /> : null}
              {approval.proposed_payload?.invoice_followup_version === 1 ? <InvoiceFollowupPreview payload={approval.proposed_payload} /> : null}
        {approval.type === "crm_change" ? <CrmGatewayPreview payload={approval.proposed_payload} /> : null}
        {canDecide ? (
          <ApprovalResolutionForm
            action={resolve}
            editableContent={approval.editable_content}
            allowEdit={!["crm_change", "appointment_change"].includes(approval.type) && approval.proposed_payload?.invoice_followup_version !== 1}
            consequence={approval.type === "crm_change" ? "Approving authorizes only this exact HubSpot change. Current grants, source versions and pause controls are checked before execution. Check Recent for a verified provider result; approval is separate from completion." : "Approving authorizes this action and queues it for delivery. Check Recent for delivery status. Rejecting cancels the proposal."}
          />
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Decisions are unavailable with your current access or connection.
          </p>
        )}
      </div>
    </BusinessDialog>
  );
}
