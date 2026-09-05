import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type BootstrapOptions = {
  email: string;
  fullName?: string;
  appUrl: string;
  dryRun: boolean;
};

export function parseBootstrapArguments(args: string[]): BootstrapOptions {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1]?.trim() : undefined;
  };
  const email = value("--email")?.toLowerCase() ?? "";
  const appUrl = (value("--app-url") ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid --email is required.");
  }
  if (!/^https:\/\/[^/]+/.test(appUrl)) {
    throw new Error("A public HTTPS --app-url or APP_URL is required.");
  }
  return {
    email,
    fullName: value("--name")?.slice(0, 120),
    appUrl,
    dryRun: args.includes("--dry-run"),
  };
}

async function findExactUser(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const exact = data.users.find((user) => user.email?.toLowerCase() === email);
    if (exact) return exact;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Auth user search exceeded 100 pages; bootstrap requires a narrower operational procedure.");
}

async function assertOwnerIdentityIsSafe(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("memberships")
    .select("role, partner_id, client_id, status")
    .eq("user_id", userId);
  if (error) throw error;
  const memberships = data ?? [];
  const conflicting = memberships.find(
    (membership) => membership.partner_id !== null || membership.client_id !== null,
  );
  if (conflicting) {
    throw new Error(
      "This email already belongs to a partner or client tenant. Use a dedicated platform-owner email.",
    );
  }
  const conflictingPlatformRole = memberships.find(
    (membership) => membership.role !== "platform_owner",
  );
  if (conflictingPlatformRole) {
    throw new Error(
      `This email already has the platform role ${conflictingPlatformRole.role}; review it manually before changing authority.`,
    );
  }
}

export async function bootstrapPlatformOwner(
  admin: SupabaseClient,
  options: BootstrapOptions,
) {
  let user = await findExactUser(admin, options.email);
  const existingUser = Boolean(user);
  if (user) await assertOwnerIdentityIsSafe(admin, user.id);
  if (options.dryRun) {
    return {
      dryRun: true,
      existingUser: Boolean(user),
      email: options.email,
      loginUrl: `${options.appUrl}/login`,
    };
  }

  if (!user) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(options.email, {
      data: options.fullName ? { full_name: options.fullName } : undefined,
      redirectTo: `${options.appUrl}/auth/confirm?next=/control/activation`,
    });
    if (error) throw error;
    user = data.user;
  }
  if (!user) throw new Error("Supabase did not return the invited owner identity.");
  await assertOwnerIdentityIsSafe(admin, user.id);

  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email: options.email,
    full_name:
      options.fullName ??
      (typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null),
  });
  if (profileError) throw profileError;
  const { data: ownerMembership, error: ownerLookupError } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "platform_owner")
    .is("partner_id", null)
    .is("client_id", null)
    .maybeSingle();
  if (ownerLookupError) throw ownerLookupError;
  const membershipMutation = ownerMembership
    ? admin
        .from("memberships")
        .update({ status: "active" })
        .eq("id", ownerMembership.id)
    : admin.from("memberships").insert({
        user_id: user.id,
        partner_id: null,
        client_id: null,
        role: "platform_owner",
        status: "active",
      });
  const { error: membershipError } = await membershipMutation;
  if (membershipError) throw membershipError;

  return {
    dryRun: false,
    existingUser,
    email: options.email,
    userId: user.id,
    loginUrl: `${options.appUrl}/login`,
  };
}

async function main() {
  const options = parseBootstrapArguments(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!/^https:\/\//.test(supabaseUrl) || serviceRoleKey.length < 20) {
    throw new Error(
      "Hosted NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await bootstrapPlatformOwner(admin, options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("bootstrap-platform-owner.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
