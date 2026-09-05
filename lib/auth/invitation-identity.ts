import type { SupabaseClient, User } from "@supabase/supabase-js";

export class InvitationIdentityError extends Error {}

// Authorization must use the identity provider's verified email, never the
// editable display profile. Exact comparison also avoids SQL ILIKE wildcards.
export async function findVerifiedInvitationIdentity(
  admin: Pick<SupabaseClient, "auth">,
  email: string,
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new InvitationIdentityError("The invitation identity could not be verified.");
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user) {
      if (!user.email_confirmed_at) {
        throw new InvitationIdentityError("This email has an unconfirmed account. Ask its owner to complete email sign-in before granting access.");
      }
      return user;
    }
    if (data.users.length < 1000) return null;
  }
  throw new InvitationIdentityError("The invitation identity lookup exceeded its limit. Contact platform support.");
}

export async function assertClientIdentityIsIndependent(
  admin: SupabaseClient,
  userId: string,
) {
  const { data, error } = await admin.from("memberships").select("id")
    .eq("user_id", userId).eq("status", "active").is("client_id", null).limit(1);
  if (error) throw new InvitationIdentityError("The invitation identity could not be verified.");
  if (data?.length) {
    throw new InvitationIdentityError("Use a dedicated business email. Platform and partner staff access clients through audited support sessions.");
  }
}
