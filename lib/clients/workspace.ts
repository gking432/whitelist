import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import type { ClientBusinessRecord } from "@/lib/clients/constants";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ClientWorkspace =
  | {
      kind: "ok";
      user: User;
      access: AccessContext;
      client: ClientBusinessRecord;
    }
  | { kind: "denied" }
  | { kind: "unavailable" };

// Memoized per request so the workspace layout and nested pages share one
// access check + client fetch.
export const loadClientWorkspace = cache(
  async (clientId: string): Promise<ClientWorkspace> => {
    const user = await requireAuthenticatedUser(`/partner/clients/${clientId}`);

    if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
      return { kind: "denied" };
    }

    let access: AccessContext;

    try {
      access = await requireClientWorkspaceAccess(user.id, clientId);
    } catch (error) {
      if (isAccessError(error)) {
        return error.code === "ACCESS_DENIED"
          ? { kind: "denied" }
          : { kind: "unavailable" };
      }

      throw error;
    }

    const supabase = await createSupabaseServerClient();

    if (!supabase) {
      return { kind: "unavailable" };
    }

    const { data, error } = await supabase
      .from("client_businesses")
      .select("*")
      .eq("id", clientId)
      .maybeSingle();

    if (error) {
      return { kind: "unavailable" };
    }

    if (!data) {
      return { kind: "denied" };
    }

    return {
      kind: "ok",
      user,
      access,
      client: data as ClientBusinessRecord,
    };
  },
);
