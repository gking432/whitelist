"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { validTimeZone } from "@/lib/business/daily-brief";
import type { ConnectedApp, ConnectionsSnapshot, ConnectionProviderOption, OwnerProvider } from "@/lib/connections/types";
import { ConnectedIntake, type IntakeSetupReceipt } from "./connected-intake";
import { OnboardingProgress } from "./onboarding-progress";
import { connectionControls, providerConnectLabel } from "./connection-controls";

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
};

export function ConnectedApps({ snapshot, outcome, timeZone }: {
  snapshot: ConnectionsSnapshot; outcome?: string; timeZone: string;
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

  async function act(action: string, provider?: OwnerProvider, connectionId?: string, permissions?: ("calendar.write" | "email.send")[]) {
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
        body: JSON.stringify({ action, ...(provider ? { provider } : {}), ...(connectionId ? { connectionId } : {}), ...(permissions ? { permissions } : {}), ...(action === "prepare_intake" ? { key: intakeKey.current } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The connection could not be updated.");
      if (action === "connect" || action === "upgrade_google_permissions") {
        if (!data.url) throw new Error("The provider did not return an authorization link. Try again.");
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
    return <article key={app.id} className="mt-5 border-t border-slate-100 pt-5">
      <p className="break-words text-sm">{app.account || app.name}</p>
      <p className="mt-1 text-xs leading-6 text-slate-500">{app.status.replaceAll("_", " ")} · {app.readOnly ? app.writePermissions?.calendarWrite || app.writePermissions?.emailSend ? "Imports are read only" : "Read only" : "Uses existing action permissions"}{app.paused ? " · Updates paused" : app.syncing ? " · Importing" : date(app.lastSyncedAt) ? ` · Updated ${date(app.lastSyncedAt)}` : " · No completed import yet"}</p>
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
          {controls.reconnect ? <button type="button" className={button} disabled={busy || !snapshot.canWrite || !option.available} onClick={() => void act("connect", option.key, app.id)}>{app.account ? app.writePermissions?.calendarWrite || app.writePermissions?.emailSend ? "Reconnect selected permissions" : "Reconnect" : `Connect ${option.label}`}</button> : null}
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
            {provider.capabilities.length ? <p className="mt-2 text-xs leading-6 text-slate-500">{provider.capabilities.map((capability) => capabilityLabels[capability] || "Import supported records").join(" · ")}</p> : null}
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
      {snapshot.limited ? <p className="mt-5 text-xs leading-6 text-slate-500">This account view is bounded. Open the source apps for their full records.</p> : null}
      <p className="mt-5 text-xs leading-6 text-slate-400">Automatic updates require a healthy background sync service. Stream status shows when records were last verified.</p>
      <div className="mt-7 flex flex-wrap gap-5 text-xs text-slate-500"><Link href="/client/onboarding" className="underline">Review facts & authority</Link><Link href="/client/money" className="underline">Money</Link><Link href="/client" className="underline">Back to Today</Link></div>
    </div>
  );
}
