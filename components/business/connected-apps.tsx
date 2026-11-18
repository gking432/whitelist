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
const button = "min-h-10 rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const capabilityLabels: Record<string, string> = {
  "message.read": "Read email", "appointment.read": "Read calendar", "invoice.read": "Read invoices",
  "payment.read": "Read payment status", "lead.webhook": "Receive form inquiries",
  "customer.read": "Read customer context", "deal.read": "Read deal context",
  "contact.create": "Propose new customers", "note.create": "Propose contact notes",
};
type CrmConfiguration = { expectedRevision: string; selectedCrm: boolean; actionsEnabled: boolean };
function HubSpotAccountControls({ app, canWrite, busy, available, configure, grant }: {
  app: ConnectedApp; canWrite: boolean; busy: boolean; available: boolean;
  configure: (configuration: CrmConfiguration) => void; grant: (permission: HubSpotOwnerPermission) => void;
}) {
  const [selected, setSelected] = useState(app.selectedCrm === true);
  const [actions, setActions] = useState(app.selectedCrm === true && app.actionsEnabled === true);
  return <div className="mt-3 space-y-3 text-xs leading-6 text-slate-500">
    <p className="break-all">HubSpot account: {app.sourceAccountId || "Source account identity unavailable"}.</p>
    <p>{app.selectedCrm ? "This account is the selected CRM." : "This account is not selected as the authoritative CRM."} Approved actions are {app.actionsEnabled ? "enabled, with individual approvals still required" : "off"}.</p>
    <p>Verified HubSpot grants: {app.writePermissions?.contactCreate ? "new customers" : "new-customer permission not granted"} · {app.writePermissions?.noteCreate ? "contact notes" : "note permission not granted"}.</p>
    <p>Connecting or granting permission does not select this CRM, enable actions, activate agents or authorize outreach.</p>
    {canWrite ? <>
      <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-medium text-slate-700">Review HubSpot permissions and controls</summary>
        <p className="mt-2">HubSpot will ask for the selected permission on this exact account. A new customer or note still needs its own owner review and approval. Existing paused work keeps its controls.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!app.writePermissions?.contactCreate ? <button type="button" className={button} disabled={busy || !available} onClick={() => grant("contact.create")}>Continue to HubSpot for new-customer permission</button> : null}
          {!app.writePermissions?.noteCreate ? <button type="button" className={button} disabled={busy || !available} onClick={() => grant("note.create")}>Continue to HubSpot for note permission</button> : null}
        </div>
        <form className="mt-4 space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); if (app.revision) configure({ expectedRevision: app.revision, selectedCrm: selected, actionsEnabled: actions }); }}>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={selected} disabled={busy} onChange={(event) => { setSelected(event.target.checked); if (!event.target.checked) setActions(false); }} />Use this exact HubSpot account as the authoritative CRM.</label>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={actions} disabled={busy || !selected} onChange={(event) => setActions(event.target.checked)} />Enable approved CRM actions on this account. This does not approve or execute a customer change.</label>
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
  const intakeKey = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (!lock.current && document.visibilityState === "visible") router.refresh();
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
    const actionPermissions = app.writePermissions?.calendarWrite || app.writePermissions?.emailSend || app.writePermissions?.contactCreate || app.writePermissions?.noteCreate;
    return <article key={app.id} className="mt-5 border-t border-slate-100 pt-5">
      <p className="break-words text-sm">{app.account || app.name}</p>
      <p className="mt-1 text-xs leading-6 text-slate-500">{app.status.replaceAll("_", " ")} · {app.readOnly ? actionPermissions ? "Imports are read only" : "Read only" : "Uses existing action permissions"}{app.paused ? " · Updates paused" : app.syncing ? " · Importing" : date(app.lastSyncedAt) ? ` · Updated ${date(app.lastSyncedAt)}` : " · No completed import yet"}</p>
      {app.provider === "hubspot" ? <HubSpotAccountControls key={app.revision || app.id} app={app} canWrite={snapshot.canWrite} busy={busy} available={option?.available === true} configure={(configuration) => void act("configure_hubspot", undefined, app.id, undefined, configuration)} grant={(permission) => void act("upgrade_hubspot_permissions", undefined, app.id, [permission])} /> : null}
      {app.provider === "hubspot" && snapshot.canWrite ? <CrmGatewayReviewWidget connectionId={app.id} timeZone={timeZone} sourceRunId={sourceRunId} /> : null}
      {app.provider === "google_workspace" ? <div className="mt-3 space-y-2 text-xs leading-6 text-slate-500">
        <p>Verified action permissions: {app.writePermissions?.calendarWrite ? "calendar changes" : "calendar changes not granted"} · {app.writePermissions?.emailSend ? "email sending" : "email sending not granted"}.</p>
        {app.writePermissions?.calendarWrite || app.writePermissions?.emailSend ? <p><Link href="/client/activate" className="underline">Review team setup and choose this account</Link> before starting approved work.</p> : null}
        {snapshot.canWrite && option?.available && !["disconnected", "revoked"].includes(app.status) ? <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium text-slate-700">Review permissions for approved work</summary>
          <p className="mt-2">Google will ask for the selected permission on this exact account. Calendar permission can create, move or cancel appointments; email permission can send mail. Existing imports, stopped channels and paused work keep their saved controls. Granting access does not activate the team or approve an action.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!app.writePermissions?.calendarWrite ? <button type="button" className={button} disabled={busy} onClick={() => void act("upgrade_google_permissions", undefined, app.id, ["calendar.write"])}>Continue to Google for calendar changes</button> : null}
            {!app.writePermissions?.emailSend ? <button type="button" className={button} disabled={busy} onClick={() => void act("upgrade_google_permissions", undefined, app.id, ["email.send"])}>Continue to Google for email sending</button> : null}
          </div>
        </details> : null}
      </div> : null}
      {app.streams?.length ? <ul className="mt-3 space-y-2">{app.streams.map((stream) => <li key={stream.key} className="text-xs leading-6 text-slate-500"><span className="font-medium capitalize">{stream.key.replaceAll("_", " ")}</span> · {stream.status}{stream.partial ? " · Partial import" : ""}{date(stream.lastSyncedAt) ? ` · ${date(stream.lastSyncedAt)}` : ""}<span className="block">{stream.detail}</span></li>)}</ul> : null}
      {app.stale ? <p className="mt-2 text-xs text-amber-800">Updates are delayed. Refresh this account to check for new records.</p> : null}
      {app.error ? <p className="mt-2 text-xs text-amber-800">{app.error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {controls.managed && option ? <>
          {controls.canPause ? <button type="button" className={button} disabled={busy || !snapshot.canWrite} onClick={() => void act(app.paused ? "resume" : "pause", undefined, app.id)}>{app.paused ? controls.intake ? "Resume intake" : "Resume updates" : controls.intake ? "Pause intake" : "Pause updates"}</button> : null}
          {controls.canRefresh ? <button type="button" className={button} disabled={busy || app.paused || !snapshot.canWrite} onClick={() => void act("refresh", undefined, app.id)}>Refresh</button> : null}
          {controls.reconnect ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !option.available} onClick={() => void act("connect", option.key, app.id)}>{app.account ? actionPermissions ? "Reconnect selected permissions" : "Reconnect" : `Connect ${option.label}`}</button> : null}
          {controls.secureSetup ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !option.available} onClick={() => void act("connect", "stripe")}>Open secure Stripe setup</button> : null}
          {controls.disconnect ? <button type="button" className={button} disabled={busy || !snapshot.canWrite} onClick={() => void act("disconnect", undefined, app.id)}>Disconnect</button> : null}
        </> : <Link href={option?.category === "mail_calendar" ? "/client/activate" : "/client/integrations"} className={`${button} inline-flex items-center`}>Manage setup</Link>}
      </div>
    </article>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-medium tracking-tight">Apps & connections</h1>
      <p className="mt-3 text-sm leading-7 text-slate-500">Bring conversations, appointments, customer inquiries and money into one workspace. Your source apps keep their own records and permissions.</p>
      <div className="mt-5"><OnboardingProgress current="apps" /></div>
      {sourceRunId ? <section className="mt-5 space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-xs leading-6 text-slate-600" aria-label="Saved work CRM handoff"><h2 className="font-medium">Saved work needs CRM review</h2><p>Read the original work and its handoff in <Link href="/client/todo" className="underline">To-do</Link> before choosing an exact HubSpot contact for a note or deliberately proposing a new customer. No identity, fields or approval are selected automatically.</p><p className="break-all">This review references saved work {sourceRunId}.</p></section> : null}
      {invalidSourceRun ? <p role="alert" className="mt-5 text-xs leading-6 text-amber-800">The saved-work reference in this link is invalid. Open its current handoff from To-do before preparing a linked proposal. No saved work will be linked from this address.</p> : null}
      {outcome && outcomes[outcome] ? <p role="status" className="mt-5 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">{outcomes[outcome]}</p> : null}
      {notice ? <p role="status" className="mt-5 text-sm text-slate-600">{notice}</p> : null}
      {error || snapshot.errors.length ? <p role="alert" className="mt-5 text-sm text-red-700">{[error, ...snapshot.errors].filter(Boolean).join(" ")}</p> : null}
      {!snapshot.canWrite ? <p className="mt-5 text-xs text-slate-500">You can view these connections. An owner with connection access can change setup.</p> : null}
      <div className="mt-7 space-y-5">
        {providers.map((provider) => {
          const accounts = snapshot.apps.filter((app) => app.provider === provider.key);
          return <section key={provider.key} className="rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-medium">{provider.label}</h2>
            <p className="mt-2 text-xs leading-6 text-slate-500">{provider.detail}</p>
            {provider.key === "hubspot" && !accounts.length ? <div className="mt-3 space-y-2 text-xs leading-6 text-slate-500"><p>Use an account owned by your business. If you do not have HubSpot, create an account there or sign in first, then return here to connect it. This workspace does not provision an account or choose a paid plan.</p><div className="flex flex-wrap gap-4">{hubspotSetupHref(provider.createAccountUrl) ? <a href={hubspotSetupHref(provider.createAccountUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Create a HubSpot account ↗</a> : null}{hubspotSetupHref(provider.signInUrl) ? <a href={hubspotSetupHref(provider.signInUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Sign in to HubSpot ↗</a> : null}</div></div> : null}
            {provider.capabilities.length ? <p className="mt-2 text-xs leading-6 text-slate-500">{provider.capabilities.map((capability) => provider.key === "hubspot" && capability === "lead.read" ? "Read deal context" : capability === "note.read" ? "Read CRM notes" : capabilityLabels[capability] || "Import supported records").join(" · ")}</p> : null}
            {provider.setup === "oauth" ? <p className="mt-2 text-xs leading-6 text-slate-500">Import access does not send messages, change bookings or activate agents.</p> : null}
            {!provider.available ? <p className="mt-3 text-xs leading-6 text-amber-800">Setup is pending for this provider. Existing records remain visible; your operator can finish the connection setup.</p> : null}
            {accounts.map((app) => accountCard(app, provider))}
            {provider.setup === "oauth" ? <button type="button" className={`${button} mt-4`} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("connect", provider.key)}>{providerConnectLabel(provider, accounts)}</button> : null}
            {provider.setup === "operator" && !accounts.length ? <button type="button" className={`${button} mt-4`} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("connect", "stripe")}>Open secure Stripe setup</button> : null}
            {provider.setup === "token" && (!accounts.length || intakePending) ? <button type="button" className={`${button} mt-4`} disabled={busy || !snapshot.canWrite || !provider.available} onClick={() => void act("prepare_intake")}>{busy ? "Preparing…" : intakePending ? "Retrieve preparation result" : "Prepare form intake"}</button> : null}
            {provider.setup === "token" && accounts.length && !intake ? <p className="mt-3 text-xs leading-6 text-slate-500">The intake connection is prepared. Use the endpoint and token saved during setup. Contact your operator if the token needs recovery or rotation.</p> : null}
          </section>;
        })}
        {snapshot.apps.filter((app) => !configuredKeys.has(app.provider as OwnerProvider)).map((app) => <section key={app.id} className="rounded-xl border border-slate-200 p-5"><h2 className="text-sm font-medium">{app.name}</h2>{accountCard(app)}</section>)}
      </div>
      {intake ? <ConnectedIntake receipt={intake} /> : null}
      <ConnectedCustomers data={snapshot} timeZone={timeZone} canWrite={snapshot.canWrite} sourceRunId={sourceRunId} />
      {snapshot.limited ? <p className="mt-5 text-xs leading-6 text-slate-500">This account view is bounded. Open the source apps for their full records.</p> : null}
      <p className="mt-5 text-xs leading-6 text-slate-400">Automatic updates require a healthy background sync service. Stream status shows when records were last verified.</p>
      <div className="mt-7 flex flex-wrap gap-5 text-xs text-slate-500"><Link href="/client/onboarding" className="underline">Review facts & authority</Link><Link href="/client/money" className="underline">Money</Link><Link href="/client" className="underline">Back to Today</Link></div>
    </div>
  );
}
