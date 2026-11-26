import type { SupabaseClient } from "@supabase/supabase-js";
import { firstOwnerUuid, parseFirstOwnerRequest } from "./first-owner-rules.ts";
export type FirstOwnerEntry =
  | { state: "new" }
  | { state: "existing"; destination: "/client" | "/partner" | "/control" }
  | { state: "blocked" | "setup_required"; reason: string };
export type FirstOwnerReceipt = { id: string; partnerId: string; clientId: string; destination: "/client/onboarding"; replayed: boolean };
type Client = Pick<SupabaseClient, "rpc">;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Uses the authenticated user's narrow RPC. Never substitutes an admin client,
 * request actor, membership flags, or browser-provided tenant identifiers. */
export async function loadFirstOwnerEntry(client: Client): Promise<FirstOwnerEntry> {
  const { data, error } = await client.rpc("get_first_owner_entry");
  if (error) throw new Error("Business setup could not be checked. Try again shortly.");
  const value = object(data);
  if (value.state === "new") return { state: "new" };
  if (value.state === "existing" && ["/client", "/partner", "/control"].includes(String(value.destination))) return { state: "existing", destination: value.destination as "/client" | "/partner" | "/control" };
  if ((value.state === "blocked" || value.state === "setup_required") && typeof value.reason === "string" && value.reason.trim()) return { state: value.state, reason: value.reason };
  throw new Error("Business setup returned an incomplete access decision. Try again shortly.");
}
export async function provisionFirstOwner(client: Client, input: unknown): Promise<FirstOwnerReceipt> {
  const request = parseFirstOwnerRequest(input);
  const { data, error } = await client.rpc("provision_first_owner", { p_key: request.key, p_business: request.business });
  if (error?.code === "P1001" || error?.code === "P1002") throw new Error("Business setup is unavailable. The operator must resolve workspace billing or capacity before you can continue.");
  if (error) throw new Error("Your business could not be created. Your access or setup may have changed. Refresh this page and try again.");
  const value = object(data);
  if (!firstOwnerUuid(value.id) || !firstOwnerUuid(value.partnerId) || !firstOwnerUuid(value.clientId) || value.destination !== "/client/onboarding" || typeof value.replayed !== "boolean")
    throw new Error("The business result could not be verified. Refresh this page before trying again.");
  return value as FirstOwnerReceipt;
}
