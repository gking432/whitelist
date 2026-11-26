import type { SupabaseClient } from "@supabase/supabase-js";

export type BrowserFixtureOwner = { label: "desktop" | "phone"; email: string; name: string; marker: string };
export type BrowserFixtureIdentity = { prefix: string; partnerId: string; packageId: string; owners: BrowserFixtureOwner[] };
export type CreatedBrowserOwner = BrowserFixtureOwner & { userId: string; membershipId: string; clientId: string; receiptId: string };
export function browserFixtureIdentity(runId: string): BrowserFixtureIdentity;
export function assertEmptyBrowserTarget(admin: SupabaseClient): Promise<void>;
export function prepareBrowserCatalog(admin: SupabaseClient, fixture: BrowserFixtureIdentity): Promise<void>;
export function readCreatedOwner(admin: SupabaseClient, fixture: BrowserFixtureIdentity, owner: BrowserFixtureOwner): Promise<CreatedBrowserOwner>;
export function cleanupBrowserFixtures(admin: SupabaseClient, fixture: BrowserFixtureIdentity): Promise<0>;
