"use server";

import { cookies, headers } from "next/headers";
import { getAppUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadFirstOwnerEntry, provisionFirstOwner } from "@/lib/auth/first-owner";
import { firstOwnerSameOrigin, firstOwnerUuid, parseFirstOwnerRequest } from "@/lib/auth/first-owner-rules";
import { GOOGLE_ONBOARDING_HANDOFF_COOKIE, readGoogleOnboardingHandoff, readGoogleOnboardingSessionId } from "@/lib/auth/google-onboarding";
import { loadClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { OnboardingSaveResponseSchema, OnboardingSnapshotSchema } from "@/lib/business/onboarding-contract";
import type { GoogleWorkspaceState } from "./google-state";

const failed = (message: string): GoogleWorkspaceState => ({ status: "error", message });
const unknown = () => failed("The result could not be confirmed. Open your saved setup before trying again.");

/** The guest draft supplies owner answers, never identity, scope or permission. */
export async function completeGoogleWorkspace(_previous: GoogleWorkspaceState, form: FormData): Promise<GoogleWorkspaceState> {
  if (!firstOwnerSameOrigin((await headers()).get("origin"), getAppUrl())) return failed("Open this site directly before continuing.");
  const mode = form.get("mode");
  if (mode !== "create" && mode !== "connect") return failed("Reload setup before continuing.");
  try {
    const client = await createSupabaseServerClient();
    if (!client) return failed("Workspace setup is temporarily unavailable. Your draft is kept in this tab.");
    const user = await client.auth.getUser();
    if (user.error || !user.data.user || user.data.user.is_anonymous || !user.data.user.email_confirmed_at || user.data.user.id !== form.get("expectedActor"))
      return failed("Your sign-in changed. Reload setup before continuing.");
    const actor = user.data.user.id;
    const session = await client.rpc("current_session_actor");
    if (session.error || session.data !== actor) return failed("Your sign-in could not be confirmed. Reload setup before continuing.");
    const jar = await cookies();
    const sessionId = await readGoogleOnboardingSessionId(client, actor);
    const handoff = sessionId ? readGoogleOnboardingHandoff(jar.get(GOOGLE_ONBOARDING_HANDOFF_COOKIE)?.value, actor, sessionId) : null;
    if (!handoff || handoff.attemptId !== form.get("attemptId") || handoff.draftId !== form.get("draftId") || handoff.requestKey !== form.get("requestKey"))
      return failed("That Google setup attempt expired or changed. Start again; your draft stays in this tab.");
    const entry = await loadFirstOwnerEntry(client);
    if (entry.state === "blocked" || entry.state === "setup_required") return failed(entry.reason);

    if (mode === "create") {
      // A committed creation with a lost reply becomes an existing workspace.
      // Never reapply the anonymous draft to that or another existing business.
      if (entry.state === "existing") {
        jar.delete(GOOGLE_ONBOARDING_HANDOFF_COOKIE);
        return { status: "complete", destination: entry.destination === "/client" ? "/client/onboarding" : entry.destination, clearGuest: false };
      }
      const request = parseFirstOwnerRequest({ key: handoff.requestKey, business: { name: form.get("name"), description: form.get("description"), timezone: form.get("timezone") } });
      const receipt = await provisionFirstOwner(client, request);
      // Reuse the atomic description command to synchronize agent knowledge
      // and advance presentation. This never confirms facts or grants authority.
      const source = await client.rpc("get_owner_onboarding", { p_client: receipt.clientId });
      const saved = !source.error ? OnboardingSnapshotSchema.safeParse(source.data) : null;
      if (!saved?.success) return unknown();
      if (saved.data.progress.revision === 0 && saved.data.answers.description === request.business.description) {
        const result = await client.rpc("save_owner_onboarding", { p_client: receipt.clientId, p_key: handoff.attemptId, p_revision: 0, p_command: { action: "answer", field: "description", value: request.business.description, expectedProfileRevision: saved.data.profileRevision } });
        const parsed = !result.error ? OnboardingSaveResponseSchema.safeParse(result.data) : null;
        if (!parsed?.success || parsed.data.result.key !== handoff.attemptId || parsed.data.result.revision !== 1 || parsed.data.snapshot.progress.revision < parsed.data.result.revision) return unknown();
      }
      jar.delete(GOOGLE_ONBOARDING_HANDOFF_COOKIE);
      return { status: "complete", destination: "/client/onboarding", clearGuest: true };
    }

    if (entry.state !== "existing" || entry.destination !== "/client") return failed("Use your existing workspace or invitation before connecting apps.");
    const portal = await loadClientPortal();
    if (portal.kind !== "ok" || portal.user.id !== actor || portal.access.role !== "client_owner" || portal.access.isImpersonating || !canWriteBusinessWorkspace(portal.access) || portal.client.id !== form.get("expectedClient"))
      return failed("Your business access changed. Reload your existing workspace before connecting apps.");
    const rawRevision = form.get("revision");
    if (typeof rawRevision !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision)) || !firstOwnerUuid(portal.client.id)) return failed("Reload your saved setup before continuing.");
    const revision = Number(rawRevision);
    // Provisioning can commit before the initial description/knowledge command
    // does. Keep untouched setup at its saved description question so the
    // owner can confirm authoritative facts through the existing atomic save.
    // This also safely resumes other existing workspaces with no setup yet.
    if (revision === 0) {
      jar.delete(GOOGLE_ONBOARDING_HANDOFF_COOKIE);
      return { status: "complete", destination: "/client/onboarding", clearGuest: false };
    }
    // Keep navigation's durable key distinct from a new owner's description
    // command, so a lost creation reply can safely resume as an existing owner.
    const result = await client.rpc("save_owner_onboarding", { p_client: portal.client.id, p_key: handoff.requestKey, p_revision: revision, p_command: { action: "navigate", step: "connections" } });
    if (result.error?.code === "PT409") return failed("Your setup changed elsewhere. Open saved setup before continuing.");
    const parsed = !result.error ? OnboardingSaveResponseSchema.safeParse(result.data) : null;
    if (!parsed?.success || parsed.data.result.key !== handoff.requestKey || parsed.data.result.revision !== revision + 1 || parsed.data.snapshot.progress.revision < parsed.data.result.revision) return unknown();
    jar.delete(GOOGLE_ONBOARDING_HANDOFF_COOKIE);
    return { status: "complete", destination: "/client/onboarding", clearGuest: false };
  } catch { return unknown(); }
}
