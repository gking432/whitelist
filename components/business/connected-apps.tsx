"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { validTimeZone } from "@/lib/business/daily-brief";
import type { ConnectedApp, ConnectionsSnapshot, ConnectionProviderOption, OwnerProvider } from "@/lib/connections/types";
import { ConnectedIntake, type IntakeSetupReceipt } from "./connected-intake";
import { OnboardingProgress } from "./onboarding-progress";
import { connectionControls, providerConnectLabel } from "./connection-controls";
import type { HubSpotOwnerPermission } from "@/lib/crm/provider-contract";
import { hubspotSetupHref } from "@/lib/crm/gateway-presentation";
import { ConnectedCustomers } from "./connected-customers";
import { CrmGatewayReviewWidget } from "./crm-gateway-review";

const outcomes: Record<string, string> = {
  permissions_updated: "Google verified the selected permissions. Review team setup before enabling work; existing pauses and stopped channels remain in force.",
  permissions_denied: "Google permission setup was cancelled. Your previous read access and controls were kept.",
  permissions_changed: "This account or its setup changed during authorization. Existing access was kept; refresh and review it again.",
  permissions_failed: "The selected Google permissions could not be verified. Existing read access was kept.",

  connected: "Account connected. The first import is queued.",
  sync_pending: "Account connected. Select Refresh to start the first import.",
  denied: "Account access was cancelled. Your previous connection is unchanged.",
  expired: "That connection request expired. Select Connect and try again.",
  permissions: "The account did not grant the requested read permissions, or a required service is unavailable. Review setup and reconnect.",
  changed: "The setup changed or a different account was selected. Reconnect the same account.",
  failed: "The account could not be connected. Try again.",
  unavailable: "The connection service is unavailable.",
  sign_in_required: "Sign in as the business owner, then connect again.",
};
const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
const capabilityLabels: Record<string, string> = {
  "message.read": "Read email", "appointment.read": "Read calendar", "invoice.read": "Read invoices",
  "payment.read": "Read payment status", "lead.webhook": "Receive form inquiries",
  "customer.read": "Read customer context", "deal.read": "Read deal context",
  "contact.create": "Propose new customers", "note.create": "Propose contact notes",
};
type CrmConfiguration = { expectedRevision: string; selectedCrm: boolean; actionsEnabled: boolean };
type AccountAction = "resume" | "pause" | "refresh" | "reconnect" | "setup" | "disconnect" | "intake" | "manage";
export function accountPrimaryAction(app: ConnectedApp, option?: ConnectionProviderOption): AccountAction {
  const controls = connectionControls(app, option);
  if (!controls.managed) return "manage";
  if (app.paused && controls.canPause) return "resume";
  if (controls.intake) return "intake";
  if (app.status !== "connected" && controls.reconnect) return "reconnect";
  if (app.status !== "connected" && controls.secureSetup) return "setup";
  if (controls.canRefresh) return "refresh";
  return controls.reconnect ? "reconnect" : controls.secureSetup ? "setup" : "manage";
}
export function connectionCardStatus(app: ConnectedApp): string {
  return app.paused ? "Paused" : app.status !== "connected" ? app.status === "needs_attention" ? "Needs attention" : "Not connected"
    : app.error ? "Needs attention" : app.syncing ? "Updating" : app.stale ? "Delayed" : "Connected";
}
function streamLabel(key: string, provider: string): string {
  const labels: Record<string, string> = { message: "Email", appointment: "Calendar", invoice: "Invoices", payment: "Payments", customer: "Customers", note: "Notes", lead: provider === "hubspot" ? "Deals" : "Form inquiries" };
  return labels[key] ?? "Imported records";
}
function HubSpotAccountControls({ app, canWrite, busy, available, configure, grant }: {
  app: ConnectedApp; canWrite: boolean; busy: boolean; available: boolean;
  configure: (configuration: CrmConfiguration) => void; grant: (permission: HubSpotOwnerPermission) => void;
}) {
  const [selected, setSelected] = useState(app.selectedCrm === true);
  const [actions, setActions] = useState(app.selectedCrm === true && app.actionsEnabled === true);
  return <div className="mt-3 space-y-3 text-xs leading-6 text-slate-500">
    <p className="break-all">HubSpot account: {app.sourceAccountId || "Source account identity unavailable"}.</p>
    <p>{app.selectedCrm ? "This account is the selected CRM." : "This account is not selected as the authoritative CRM."} Approved actions are {app.actionsEnabled ? "enabled, with individual approvals still required" : "off"}.</p>
    <p>Saved HubSpot permissions: {app.writePermissions?.contactCreate ? "new customers" : "new-customer permission not granted"} · {app.writePermissions?.noteCreate ? "contact notes" : "note permission not granted"}.</p>
    <p>Connecting or granting permission does not select this CRM, enable actions, activate agents or authorize outreach.</p>
    {canWrite ? <>
      <details className="rounded-lg border border-slate-200 px-3 pb-3"><summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-700">Review HubSpot permissions and controls</summary>
        <p className="mt-2">HubSpot will ask for the selected permission on this exact account. A new customer or note still needs its own owner review and approval. Existing paused work keeps its controls.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!app.writePermissions?.contactCreate ? <button type="button" className={button} disabled={busy || !available} onClick={() => grant("contact.create")}>Continue to HubSpot for new-customer permission</button> : null}
          {!app.writePermissions?.noteCreate ? <button type="button" className={button} disabled={busy || !available} onClick={() => grant("note.create")}>Continue to HubSpot for note permission</button> : null}
        </div>
        <form className="mt-4 space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); if (app.revision) configure({ expectedRevision: app.revision, selectedCrm: selected, actionsEnabled: actions }); }}>
          <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1" checked={selected} disabled={busy} onChange={(event) => { setSelected(event.target.checked); if (!event.target.checked) setActions(false); }} />Use this exact HubSpot account as the authoritative CRM.</label>
          <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1" checked={actions} disabled={busy || !selected} onChange={(event) => setActions(event.target.checked)} />Enable approved CRM actions on this account. This does not approve or execute a customer change.</label>
          <button type="submit" className={button} disabled={busy || !app.revision}>Save CRM controls</button>
          {!app.revision ? <p>Refresh this account to load a current configuration version before saving controls.</p> : null}
        </form>
      </details>
    </> : null}
  </div>;
}

export function ConnectedApps({ snapshot, outcome, timeZone, sourceRunId, invalidSourceRun = false }: {
  snapshot: ConnectionsSnapshot; outcome?: string; timeZone: string; sourceRunId?: string; invalidSourceRun?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [intake, setIntake] = useState<IntakeSetupReceipt | null>(null);
  const [intakePending, setIntakePending] = useState(false);
  const lock = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const intakeKey = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (!lock.current && document.visibilityState === "visible" && !container.current?.querySelector("details[open], input:focus, select:focus, textarea:focus")) router.refresh();
    };
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [router]);

  async function act(action: string, provider?: OwnerProvider, connectionId?: string, permissions?: ("calendar.write" | "email.send" | HubSpotOwnerPermission)[], configuration?: CrmConfiguration) {
    if (lock.current || !snapshot.canWrite) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    if (action === "prepare_intake") {
      if (!intakeKey.current) intakeKey.current = crypto.randomUUID();
      setIntakePending(true);
    }
    try {
      const response = await fetch("/api/connections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(provider ? { provider } : {}), ...(connectionId ? { connectionId } : {}), ...(permissions ? { permissions } : {}), ...(configuration ?? {}), ...(action === "prepare_intake" ? { key: intakeKey.current } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The connection could not be updated.");
      if (action === "connect" || action === "upgrade_google_permissions" || action === "upgrade_hubspot_permissions") {
        if (!data.url) throw new Error("The provider did not return an authorization link. Try again.");
        if ((provider === "hubspot" || action === "upgrade_hubspot_permissions") && !hubspotSetupHref(data.url)) throw new Error("The HubSpot authorization address could not be verified. Refresh and try again.");
        window.location.assign(data.url);
        return;
      }
      if (action === "prepare_intake") {
        if (!data.connectionId || !data.url || !data.token || data.header !== "x-webhook-token")
          throw new Error("The form setup receipt could not be confirmed. Retry this preparation to retrieve the same result.");
        setIntake(data as IntakeSetupReceipt);
        setIntakePending(false);
      } else setNotice(data.message || "Connection change saved. Check the current status below.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection unavailable.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const providers: ConnectionProviderOption[] = snapshot.providers ?? [{
    key: "google_workspace", label: "Google", category: "mail_calendar", setup: "oauth",
    available: snapshot.googleAvailable, detail: "Read Gmail and your primary Google calendar.", capabilities: ["Read email", "Read calendar"],
  }];
  const configuredKeys = new Set(providers.map((provider) => provider.key));
  const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(timeZone), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : null;

  function accountCard(app: ConnectedApp, option?: ConnectionProviderOption) {
    const controls = connectionControls(app, option);
    const permissions = app.writePermissions;
    const hasActions = permissions?.calendarWrite || permissions?.emailSend || permissions?.contactCreate || permissions?.noteCreate;
    const primary = accountPrimaryAction(app, option);
    const control = (kind: AccountAction, key = kind) => {
      const disabled = busy || !snapshot.canWrite;
      if (kind === "resume") return <button key={key} type="button" className={button} disabled={disabled} onClick={() => void act("resume", undefined, app.id)}>{controls.intake ? "Resume intake" : "Resume updates"}</button>;
      if (kind === "pause") return <button key={key} type="button" className={button} disabled={disabled} onClick={() => void act("pause", undefined, app.id)}>{controls.intake ? "Pause intake" : "Pause updates"}</button>;
      if (kind === "refresh") return <button key={key} type="button" className={button} disabled={disabled || app.paused} onClick={() => void act("refresh", undefined, app.id)}>Refresh</button>;
      if (kind === "reconnect" && option) return <button key={key} type="button" className={button} disabled={disabled || !option.available} onClick={() => void act("connect", option.key, app.id)}>{app.account ? hasActions ? "Reconnect permissions" : "Reconnect" : `Connect ${option.label}`}</button>;
      if (kind === "setup") return <button key={key} type="button" className={button} disabled={disabled || !option?.available} onClick={() => void act("connect", "stripe")}>Secure Stripe setup</button>;
      if (kind === "disconnect") return <button key={key} type="button" className={button} disabled={disabled} onClick={() => void act("disconnect", undefined, app.id)}>Disconnect</button>;
      if (kind === "intake") return <Link key={key} href="/client/messages#form-inquiries" className={button}>View inquiries</Link>;
      return <Link key={key} href={option?.category === "mail_calendar" ? "/client/activate" : "/client/integrations"} className={button}>Manage setup</Link>;
    };
    const otherControls: AccountAction[] = controls.managed ? [
      ...(controls.canPause ? [app.paused ? "resume" as const : "pause" as const] : []),
      ...(controls.canRefresh ? ["refresh" as const] : []), ...(controls.reconnect ? ["reconnect" as const] : []),
      ...(controls.secureSetup ? ["setup" as const] : []), ...(controls.disconnect ? ["disconnect" as const] : []),
    ].filter((kind) => kind !== primary) : [];
    return <article key={app.id} className="min-w-0 rounded-xl border border-slate-200 bg-white" aria-label={`${option?.label || app.name} account ${app.account || app.name}`}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-all text-sm font-medium text-slate-800">{app.account || app.name}</p><span className={`rounded-full px-2.5 py-1 text-xs ${app.error || app.status === "needs_attention" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{connectionCardStatus(app)}</span></div>
        <p className="text-xs leading-6 text-slate-500">{date(app.lastSyncedAt) ? `Last import ${date(app.lastSyncedAt)}` : "No completed import yet"}</p>
        {app.error || app.status === "needs_attention" ? <p className="text-xs leading-6 text-amber-800">{controls.intake && !app.lastSyncedAt && !app.error ? "Waiting for the first form inquiry." : "This account needs attention to keep records current."}</p> : app.paused ? <p className="text-xs leading-6 text-slate-500">Updates are paused. Saved records stay visible.</p> : app.stale && !app.syncing ? <p className="text-xs leading-6 text-amber-800">Some records may be out of date.</p> : null}
        <div>{control(primary)}</div>
      </div>
      <details className="border-t border-slate-100" open={app.provider === "hubspot" && !!sourceRunId}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-xs font-medium text-slate-500">Account controls &amp; details</summary>
        <div className="space-y-4 px-4 pb-4 text-xs leading-6 text-slate-500">
          <p>{app.readOnly ? "Imports are read only." : "This account uses its existing action permissions."} Changes and messages use separate team controls and approvals.</p>
          {otherControls.length ? <div className="flex flex-wrap gap-2">{otherControls.map((kind) => control(kind))}</div> : null}
          {app.provider === "hubspot" ? <HubSpotAccountControls key={app.revision || app.id} app={app} canWrite={snapshot.canWrite} busy={busy} available={option?.available === true} configure={(configuration) => void act("configure_hubspot", undefined, app.id, undefined, configuration)} grant={(permission) => void act("upgrade_hubspot_permissions", undefined, app.id, [permission])} /> : null}
          {app.provider === "google_workspace" ? <div className="space-y-3">
            <p>Calendar changes: {permissions?.calendarWrite ? "permission granted" : "not granted"}. Email sending: {permissions?.emailSend ? "permission granted" : "not granted"}.</p>
            {permissions?.calendarWrite || permissions?.emailSend ? <p><Link href="/client/activate" className="underline">Review team setup and choose this account</Link> before starting approved work.</p> : null}
            {snapshot.canWrite && option?.available && !["disconnected", "revoked"].includes(app.status) ? <details className="rounded-lg border border-slate-200 px-3"><summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-700">Permissions for approved work</summary><div className="space-y-3 pb-3"><p>Google will ask for the selected permission on this exact account. Granting access keeps your saved pauses and does not activate the team or approve an action.</p><div className="flex flex-wrap gap-2">{!permissions?.calendarWrite ? <button type="button" className={button} disabled={busy} onClick={() => void act("upgrade_google_permissions", undefined, app.id, ["calendar.write"])}>Allow calendar changes</button> : null}{!permissions?.emailSend ? <button type="button" className={button} disabled={busy} onClick={() => void act("upgrade_google_permissions", undefined, app.id, ["email.send"])}>Allow email sending</button> : null}</div></div></details> : null}
          </div> : null}
          {app.streams?.length ? <dl className="divide-y divide-slate-100">{app.streams.map((stream) => <div key={stream.key} className="py-2"><dt className="font-medium text-slate-700">{streamLabel(stream.key, app.provider)} · {stream.status === "fresh" ? "Current" : stream.status === "error" ? "Needs attention" : stream.status === "missing" ? "Not imported" : stream.status === "stale" ? "Delayed" : "Paused"}{stream.partial ? " · Partial coverage" : ""}</dt><dd>{date(stream.lastSyncedAt) ? `Last import ${date(stream.lastSyncedAt)}. ` : ""}{stream.detail}</dd></div>)}</dl> : null}
          <details><summary className="flex min-h-11 cursor-pointer items-center font-medium">Connection information</summary><div className="space-y-1 break-words pb-2"><p>Status: {app.status.replaceAll("_", " ")}</p>{app.sourceAccountId ? <p className="break-all">Source account: {app.sourceAccountId}</p> : null}{app.error ? <p className="text-amber-800">{app.error}</p> : null}</div></details>
          {app.provider === "hubspot" && snapshot.canWrite ? <CrmGatewayReviewWidget connectionId={app.id} timeZone={timeZone} sourceRunId={sourceRunId} /> : null}
        </div>
      </details>
    </article>;
  }
  const unavailable = providers.filter((provider) => !provider.available);
  const hasCustomerContext = snapshot.apps.some((app) => app.provider === "hubspot") || !!snapshot.customers?.length || !!snapshot.crmDeals?.length;
  return <div ref={container} className="min-w-0 max-w-3xl">
    <h1 className="text-2xl font-medium tracking-tight">Apps &amp; connections</h1>
    <p className="mt-2 text-sm leading-7 text-slate-500">Your accounts, records and update status in one place.</p>
    <div className="mt-4"><OnboardingProgress current="apps" /></div>
    {sourceRunId ? <section className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm leading-6 text-slate-600" aria-label="Saved work CRM handoff"><h2 className="font-medium">Customer review from saved work</h2><p className="mt-1">Check its <Link href="/client/todo" className="underline">To-do handoff</Link>, then choose an exact HubSpot contact or review a deliberately new customer.</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Work reference</summary><p className="break-all">{sourceRunId}</p></details></section> : null}
    {invalidSourceRun ? <p role="alert" className="mt-5 text-sm leading-6 text-amber-800">This work reference is invalid. Open the current handoff from To-do.</p> : null}
    {outcome && outcomes[outcome] ? <p role="status" className="mt-5 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">{outcomes[outcome]}</p> : null}
    {notice ? <p role="status" className="mt-5 text-sm text-slate-600">{notice}</p> : null}
    {error || snapshot.errors.length ? <p role="alert" className="mt-5 text-sm text-red-700">{[error, ...snapshot.errors].filter(Boolean).join(" ")}</p> : null}
    {!snapshot.canWrite ? <p className="mt-5 text-xs leading-6 text-slate-500">View-only access. An owner with connection access can change setup.</p> : null}
    {unavailable.length ? <aside className="mt-5 rounded-xl border border-amber-100 bg-amber-50/50 p-4 text-sm leading-6 text-amber-900" aria-label="Platform connection setup"><p className="font-medium">Some connections need platform setup</p><p className="mt-1">Ask your administrator to enable {unavailable.map((provider) => provider.label).join(", ")}. Saved accounts and records stay visible here.</p></aside> : null}
    <div className="mt-6 space-y-6">
      {providers.map((provider) => {
        const accounts = snapshot.apps.filter((app) => app.provider === provider.key);
        return <section key={provider.key} className="min-w-0 space-y-3" aria-label={provider.label}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-800">{provider.label}</h2>{accounts.length && provider.setup === "oauth" ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("connect", provider.key)}>{providerConnectLabel(provider, accounts)}</button> : null}</div>
          {accounts.map((app) => accountCard(app, provider))}
          {!accounts.length ? <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{provider.setup === "token" ? "Receive inquiries from your website form." : provider.key === "hubspot" ? "Bring in your existing customers and deals." : provider.key === "stripe" ? "Bring in invoices and payment status." : "Bring in email and calendar records."}</p><div className="mt-3">{provider.setup === "oauth" ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("connect", provider.key)}>{providerConnectLabel(provider, accounts)}</button> : provider.setup === "operator" ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("connect", "stripe")}>Secure Stripe setup</button> : <button type="button" className={button} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("prepare_intake")}>{busy ? "Preparing…" : intakePending ? "Retrieve preparation result" : "Prepare form intake"}</button>}</div>
            {provider.key === "hubspot" ? <details className="mt-2 text-xs leading-6 text-slate-500"><summary className="flex min-h-11 cursor-pointer items-center">Need a HubSpot account?</summary><p>Use an account owned by your business. Create or sign in to it in HubSpot, then return to connect.</p><div className="mt-2 flex flex-wrap gap-4">{hubspotSetupHref(provider.createAccountUrl) ? <a href={hubspotSetupHref(provider.createAccountUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Create account ↗</a> : null}{hubspotSetupHref(provider.signInUrl) ? <a href={hubspotSetupHref(provider.signInUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Sign in ↗</a> : null}</div></details> : null}
          </div> : null}
          {provider.setup === "token" && accounts.length && intakePending ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("prepare_intake")}>Retrieve preparation result</button> : null}
          <details className="text-xs leading-6 text-slate-500"><summary className="flex min-h-11 cursor-pointer items-center">About {provider.label}</summary><div className="space-y-2 pb-2"><p>{provider.detail}</p>{provider.capabilities.length ? <p>{provider.capabilities.map((capability) => provider.key === "hubspot" && capability === "lead.read" ? "Read deal context" : capability === "note.read" ? "Read CRM notes" : capabilityLabels[capability] || "Import supported records").join(" · ")}</p> : null}{provider.setup === "oauth" ? <p>Import access does not send messages, change appointments or activate your team.</p> : provider.setup === "token" && accounts.length && !intake ? <p>Use the endpoint and token saved during setup. Ask your administrator about recovery or rotation.</p> : null}</div></details>
        </section>;
      })}
      {snapshot.apps.filter((app) => !configuredKeys.has(app.provider as OwnerProvider)).map((app) => <section key={app.id} className="space-y-3"><h2 className="text-sm font-semibold">{app.name}</h2>{accountCard(app)}</section>)}
    </div>
    {intake ? <ConnectedIntake receipt={intake} /> : null}
    {hasCustomerContext ? <details className="mt-7 rounded-xl border border-slate-200 bg-white" open={!!sourceRunId}><summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-slate-700">Customer context</summary><div className="px-4 pb-4"><ConnectedCustomers data={snapshot} timeZone={timeZone} canWrite={snapshot.canWrite} sourceRunId={sourceRunId} /></div></details> : null}
    {snapshot.limited ? <p className="mt-5 text-xs leading-6 text-slate-500">Only a bounded set of records is shown. Open the source apps for full history.</p> : null}
    <div className="mt-7 flex flex-wrap gap-5 text-xs text-slate-500"><Link href="/client/onboarding" className="underline">Facts &amp; authority</Link><Link href="/client/money" className="underline">Money</Link><Link href="/client" className="underline">Back to Today</Link></div>
  </div>;
}
