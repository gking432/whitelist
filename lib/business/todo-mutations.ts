import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "./access.ts";

export const TODO_COMMAND = z
  .object({
    action: z.literal("task_status"),
    id: z.uuid(),
    status: z.enum(["open", "done"]),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function mutateTodo(
  admin: SupabaseClient,
  portal: Extract<ClientPortal, { kind: "ok" }>,
  input: unknown,
) {
  if (!canWriteBusinessWorkspace(portal.access))
    throw new Error("You do not have permission to change this work.");
  const command = TODO_COMMAND.parse(input);
  const { data, error } = await admin
    .from("crm_tasks")
    .update({
      status: command.status,
      completed_at: command.status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", command.id)
    .eq("partner_id", portal.client.partner_id)
    .eq("client_id", portal.client.id)
    .eq("updated_at", command.updatedAt)
    .in("status", ["open", "done"])
    .select("id")
    .maybeSingle();
  if (error || !data)
    throw new Error(
      "This task changed or is unavailable. Refresh before trying again.",
    );
  return {
    ok: true,
    message: command.status === "done" ? "Task completed." : "Task reopened.",
  };
}
