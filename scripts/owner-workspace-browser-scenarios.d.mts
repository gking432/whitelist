import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspacePreferences } from "../lib/business/workspace-preferences-contract.ts";
import type { BrowserCiEnvironment, OwnerBrowserTarget } from "./verify-owner-browser.mjs";
export type WorkspaceActivityFixtureRow = {
  user_id: string; client_id: string; partner_id: string; module: "messages" | "appointments"; activity_date: string;
};
export type WorkspaceScenarioOwner = {
  userId: string; clientId: string; label: "desktop" | "phone"; marker: string; receiptId: string; name: string;
  page: object; workspacePreferences?: WorkspacePreferences;
};
export function workspaceActivityFixture(owner: Pick<WorkspaceScenarioOwner, "userId" | "clientId" | "label">, partnerId: string, clock?: Date, timeZone?: string): WorkspaceActivityFixtureRow[];
export function assertSavedWorkspacePreferences(page: { request: { get(url: string): Promise<{ status(): number; json(): Promise<unknown> }> } }, appUrl: string, expected: WorkspacePreferences): Promise<void>;
export function assertOwnerWorkspaceNavigation(page: object, businessName: string): Promise<void>;
export function runOwnerWorkspaceScenarios(options: {
  admin: SupabaseClient; fixture: { prefix: string; partnerId: string }; owners: WorkspaceScenarioOwner[]; target: OwnerBrowserTarget;
  step(key: string, action: () => Promise<void>): Promise<void>;
  screenshot(page: object, target: OwnerBrowserTarget, name: string): Promise<void>; env?: BrowserCiEnvironment;
}): Promise<{ actualPreferenceApi: boolean; realNavigationActivity: boolean; syntheticActivityDays: boolean; concurrentCompareAndSwap: boolean; exactRetry: boolean; partialCoverageVisible: boolean; owners: { label: string; preferences: WorkspacePreferences; recommendation: string }[] }>;
