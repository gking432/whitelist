import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessCommandResult } from "./context-contract.ts";
import { BusinessCommandError, normalizeContextCommand } from "./context-commands.ts";

export type BusinessCommandActor = { partnerId: string; clientId: string; actorId: string; canWrite: boolean };
export type CommandRepository = {
  apply(actor: BusinessCommandActor, command: ReturnType<typeof normalizeContextCommand>): Promise<BusinessCommandResult>;
};
export async function executeContextCommand(repository: CommandRepository, actor: BusinessCommandActor, raw: unknown) {
  if (!actor.canWrite) throw new BusinessCommandError("Business owner write access is required.", 403);
  const command = normalizeContextCommand(raw);
  const result = await repository.apply(actor, command);
  if (!result || typeof result.id !== "string" || !result.id || !Number.isInteger(result.revision) || result.revision < 0 ||
    typeof result.message !== "string" || !result.message.trim() || !Number.isInteger(result.cancelledWork) || result.cancelledWork < 0 || typeof result.replayed !== "boolean")
    throw new BusinessCommandError("The saved result could not be confirmed. Retry with the same request key.", 503);
  return result;
}
export function supabaseCommandRepository(admin: SupabaseClient): CommandRepository {
  return { async apply(actor, command) {
    const { data, error } = await admin.rpc("apply_business_context_command", {
      p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: command,
    });
    if (error) {
      if (error.code === "40001" || error.message.includes("changed") || error.message.includes("key reused"))
        throw new BusinessCommandError("The business context or authority changed. Refresh and review before retrying.", 409);
      if (error.code === "22023") throw new BusinessCommandError("Review the current business context before enabling drafting or approved actions.", 422);
      throw new BusinessCommandError("The change could not be saved. Retry with the same request key.", 503);
    }
    return data as BusinessCommandResult;
  } };
}
