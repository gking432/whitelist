"use server";

import { revalidatePath } from "next/cache";

import { getAuthState } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/forms/state";
import {
  connectionSetupPath,
  encryptConnectionSetupToken,
  generateConnectionSetupToken,
  hashConnectionSetupToken,
  isConnectionSetupProviderKey,
} from "@/lib/integrations/connection-setup";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { requireClientWorkspaceAccess } from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConnectionLinkState = FormState & { setupUrl?: string };

export async function createConnectionSetupLink(
  clientId: string,
  _previousState: ConnectionLinkState,
  formData: FormData,
): Promise<ConnectionLinkState> {
  const auth = await getAuthState();
  if (!auth.user) return { status: "error", message: "Sign in first." };
  if (!isSecretsEncryptionConfigured()) {
    return {
      status: "error",
      message: "Secret storage must be configured before creating setup links.",
    };
  }

  const requested = formData
    .getAll("providers")
    .map(String)
    .filter(isConnectionSetupProviderKey);
  const crmProvider = String(formData.get("crm_provider") ?? "");
  if (isConnectionSetupProviderKey(crmProvider)) requested.push(crmProvider);
  const productivityProvider = String(
    formData.get("productivity_provider") ?? "",
  );
  if (isConnectionSetupProviderKey(productivityProvider)) {
    requested.push(productivityProvider);
  }
  const fieldServiceProvider = String(
    formData.get("field_service_provider") ?? "",
  );
  if (isConnectionSetupProviderKey(fieldServiceProvider)) {
    requested.push(fieldServiceProvider);
  }
  const providers = Array.from(new Set(requested));
  if (providers.length === 0) {
    return {
      status: "error",
      message: "Select at least one account for the client to connect.",
    };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      auth.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );
    const supabase = await createSupabaseServerClient();
    if (!supabase || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    await supabase
      .from("client_connection_setup_sessions")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("partner_id", access.partnerId)
      .eq("client_id", clientId)
      .eq("status", "active");

    const token = generateConnectionSetupToken();
    const { error } = await supabase
      .from("client_connection_setup_sessions")
      .insert({
        partner_id: access.partnerId,
        client_id: clientId,
        token_hash: hashConnectionSetupToken(token),
        encrypted_token: encryptConnectionSetupToken(token),
        allowed_provider_keys: providers,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: access.userId,
      });

    if (error) {
      return { status: "error", message: "The secure link could not be created." };
    }

    revalidatePath(`/partner/clients/${clientId}/connections`);
    return {
      status: "success",
      message: "Secure setup link created. It expires in 7 days.",
      setupUrl: `${getAppUrl().replace(/\/$/, "")}${connectionSetupPath(token)}`,
    };
  } catch {
    return {
      status: "error",
      message: "You do not have permission to create this setup link.",
    };
  }
}

export async function revokeConnectionSetupLinks(
  clientId: string,
): Promise<FormState> {
  const auth = await getAuthState();
  if (!auth.user) return { status: "error", message: "Sign in first." };

  try {
    const access = await requireClientWorkspaceAccess(
      auth.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );
    const supabase = await createSupabaseServerClient();
    if (!supabase || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }
    await supabase
      .from("client_connection_setup_sessions")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("partner_id", access.partnerId)
      .eq("client_id", clientId)
      .eq("status", "active");
    revalidatePath(`/partner/clients/${clientId}/connections`);
    return { status: "success", message: "Active setup links revoked." };
  } catch {
    return { status: "error", message: "The setup links could not be revoked." };
  }
}
