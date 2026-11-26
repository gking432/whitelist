import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceModule, WorkspacePreferences } from "../lib/business/workspace-preferences-contract.ts";
import type { BrowserCiEnvironment, OwnerBrowserTarget, OwnerWorkspaceAccessDiagnosis } from "./verify-owner-browser.mjs";
export type WorkspaceActivityFixtureRow = {
  user_id: string; client_id: string; partner_id: string; module: "messages" | "appointments"; activity_date: string;
};
export type WorkspaceScenarioOwner = {
  userId: string; clientId: string; label: "desktop" | "phone"; marker: string; receiptId: string; name: string;
  page: object; workspacePreferences?: WorkspacePreferences;
};
export function withOwnerBrowserDeadline<T>(label: string, action: () => T | PromiseLike<T>, timeoutMs?: number): Promise<Awaited<T>>;
export type WorkspacePreferencePostOutcome =
  | { complete: true; status: number; body: unknown; failedAt: null; reason: null }
  | { complete: false; status: number | null; body: null; failedAt: "headers" | "json_body"; reason: "timeout" | "invalid_json" | "request_failed" };
export function collectWorkspacePreferencePosts(input: { path: string; bodies: readonly unknown[] }, request?: typeof fetch): Promise<WorkspacePreferencePostOutcome[]>;
export type WorkspacePreferenceTrace = { operation: string; phase?(label: string): Promise<void>; diagnose403?(): Promise<unknown> };
export type WorkspacePreferenceResponse = { status(): number; json(): Promise<unknown>; headers?(): Record<string, string> | Promise<Record<string, string>> };
export function inspectWorkspacePreferenceResponse(response: WorkspacePreferenceResponse, trace: WorkspacePreferenceTrace, requireJson?: boolean): Promise<unknown>;
export function readWorkspacePreferenceSnapshot(page: { request: { get(url: string, options?: { timeout: number }): Promise<WorkspacePreferenceResponse> } }, appUrl: string, trace?: WorkspacePreferenceTrace): Promise<import("../lib/business/workspace-preferences-contract.ts").WorkspacePersonalization>;
export type WorkspaceActivityRequest = { url(): string; method(): string; postDataJSON(): unknown };
export type WorkspaceActivityResponse = { request(): WorkspaceActivityRequest; status(): number };
export function observeNewWorkspaceActivity(page: {
  on(event: "request", listener: (request: WorkspaceActivityRequest) => void): unknown;
  off(event: "request", listener: (request: WorkspaceActivityRequest) => void): unknown;
  waitForResponse(predicate: (response: WorkspaceActivityResponse) => boolean, options: { timeout: number }): Promise<WorkspaceActivityResponse>;
}, appUrl: string, area: WorkspaceModule, timeoutMs?: number): Promise<WorkspaceActivityResponse>;
export function workspaceActivityFixture(owner: Pick<WorkspaceScenarioOwner, "userId" | "clientId" | "label">, partnerId: string, clock?: Date, timeZone?: string): WorkspaceActivityFixtureRow[];
export function assertSavedWorkspacePreferences(page: { request: { get(url: string): Promise<{ status(): number; json(): Promise<unknown> }> } }, appUrl: string, expected: WorkspacePreferences, trace?: WorkspacePreferenceTrace): Promise<void>;
export function assertOwnerWorkspaceNavigation(page: object, businessName: string): Promise<void>;
export function runOwnerWorkspaceScenarios(options: {
  admin: SupabaseClient; fixture: { prefix: string; partnerId: string }; owners: WorkspaceScenarioOwner[]; target: OwnerBrowserTarget;
  step(key: string, action: () => Promise<void>): Promise<void>;
  phase?(label: string): Promise<void>;
  diagnoseAccess?(owner: WorkspaceScenarioOwner): Promise<OwnerWorkspaceAccessDiagnosis>;
  screenshot(page: object, target: OwnerBrowserTarget, name: string): Promise<void>; env?: BrowserCiEnvironment;
}): Promise<{ actualPreferenceApi: boolean; realNavigationActivity: boolean; syntheticActivityDays: boolean; concurrentCompareAndSwap: boolean; exactRetry: boolean; partialCoverageVisible: boolean; owners: { label: string; preferences: WorkspacePreferences; recommendation: string }[] }>;
