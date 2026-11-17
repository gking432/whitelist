"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mutateBusinessWorkspace } from "@/lib/business/mutations";
import type { FormState } from "@/lib/forms/state";

const decisionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  resolution: z.enum(["approve", "reject"]),
});

export async function resolveMobileBusinessDecision(
  input: unknown,
): Promise<FormState> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success)
    return { status: "error", message: "Choose a valid decision." };
  const portal = await loadClientPortal();
  if (portal.kind !== "ok")
    return { status: "error", message: "Sign in to review this item." };
  const db = createSupabaseAdminClient();
  if (!db)
    return { status: "error", message: "The data service is unavailable." };
  try {
    await mutateBusinessWorkspace(db, portal, {
      action: "transition",
      id: parsed.data.id,
      revision: parsed.data.revision,
      transition: parsed.data.resolution,
    });
    revalidatePath("/client", "layout");
    return {
      status: "success",
      message:
        parsed.data.resolution === "approve"
          ? "Approved. Your decision is saved; external work is completed separately."
          : "Declined. The item can now be revised.",
    };
  } catch {
    return {
      status: "error",
      message:
        "This item may have changed, or your account cannot approve it. Close it and refresh before trying again.",
    };
  }
}
