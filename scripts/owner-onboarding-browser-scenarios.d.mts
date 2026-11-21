import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingRequest, OnboardingSaveResponse, OnboardingSnapshot } from "../lib/business/onboarding-contract.ts";
import type { BrowserCiEnvironment, OwnerBrowserTarget } from "./verify-owner-browser.mjs";
export type OnboardingHttpResponse = { status(): number; json(): Promise<unknown> };
export type OnboardingBrowserContext = { request: {
  get(url: string, options: { headers: Record<string, string>; timeout: number }): Promise<OnboardingHttpResponse>;
  post(url: string, options: { headers: Record<string, string>; data: unknown; timeout: number }): Promise<OnboardingHttpResponse>;
} };
export type OnboardingOwner = { label: "desktop" | "phone"; userId: string; clientId: string; membershipId: string; receiptId: string; marker: string; page: object; context: OnboardingBrowserContext };
export type OnboardingReport = { version: number; status: "in_progress" | "passed" | "failed"; activeStep: string | null; checks: { key: string; status: "passed" | "failed" }[]; fixtureCleanup: "not_started" | "complete" | "failed"; modelCalls: false; providerWrites: false; businessStatePreserved: boolean; limitations: string[] };
export function assertOnboardingSnapshot(value: unknown): OnboardingSnapshot;
export function assertOnboardingSave(value: unknown, command: OnboardingRequest, replayed: boolean): OnboardingSaveResponse;
export function onboardingApi(context: OnboardingBrowserContext, target: Pick<OwnerBrowserTarget, "appUrl">, scopeKey: string, body?: unknown, options?: { expected?: number[]; phase?(label: string): Promise<void>; operation?: string; origin?: string; omitScope?: boolean }): Promise<{ status: number; body: unknown }>;
export type OnboardingObservedRequest = { url(): string; method(): string; postDataJSON(): unknown };
export type OnboardingObservedResponse = { request(): OnboardingObservedRequest; status(): number };
export function observeOnboardingPost(page: { on(event: "request", callback: (request: OnboardingObservedRequest) => void): unknown; off(event: "request", callback: (request: OnboardingObservedRequest) => void): unknown; waitForResponse(predicate: (response: OnboardingObservedResponse) => boolean, options: { timeout: number }): Promise<OnboardingObservedResponse> }, appUrl: string, expected: Record<string, string>, action: () => Promise<unknown>): Promise<void>;
export function assertOnboardingLayout(page: object): Promise<void>;
export function finishInitialOwnerOnboarding(options: { page: object; target: Pick<OwnerBrowserTarget, "appUrl">; scopeKey: string; businessName: string; phase?(label: string): Promise<void> }): Promise<void>;
export function runOwnerOnboardingBrowserScenarios(options: { admin: SupabaseClient; fixture: { prefix: string; partnerId: string }; owners: OnboardingOwner[]; target: OwnerBrowserTarget; phase?(label: string): Promise<void>; onProgress?(report: OnboardingReport): Promise<void>; screenshot(page: object, target: OwnerBrowserTarget, name: string): Promise<void>; env?: BrowserCiEnvironment }): Promise<OnboardingReport>;
