import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck, UsersRound } from "lucide-react";
import { NorthstarMark } from "@/components/brand/northstar-mark";
import { openTestWorkspace } from "@/app/workspaces/actions";
import { getAuthState } from "@/lib/auth/session";
import { isAccessError, requirePlatformRole } from "@/lib/permissions/access";

const workspaces = [
  {
    title: "Platform owner",
    layer: "owner",
    audience: "Run the platform",
    description:
      "See every partner and client, handle escalations, and manage your platform.",
    href: "/control",
    icon: ShieldCheck,
  },
  {
    title: "Partner",
    layer: "partner",
    audience: "Grow your agency",
    description:
      "Set up your brand, add clients, and launch their AI solutions and automations.",
    href: "/workspaces/partner",
    icon: UsersRound,
  },
  {
    title: "Client",
    layer: "client",
    audience: "Run your business",
    description:
      "Work with your customers, review AI activity, and manage everyday tasks.",
    href: "/workspaces/client",
    icon: Building2,
  },
] as const;

export default async function HomePage() {
  const { user } = await getAuthState();
  let canTest = false;
  if (user) {
    try {
      await requirePlatformRole(user.id, ["platform_owner", "platform_admin"]);
      canTest = true;
    } catch (error) {
      if (!isAccessError(error) || error.code !== "ACCESS_DENIED") throw error;
    }
  }
  return (
    <main className="min-h-screen bg-brand-deep text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(70rem 45rem at 80% -15%, rgba(199,154,59,0.13), transparent 60%), radial-gradient(55rem 40rem at -15% 115%, rgba(44,106,79,0.45), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between gap-4">
          <NorthstarMark subtitle="AI & automation platform" />
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/65">
            Beta
          </span>
        </header>
        <section className="ns-fade-up flex flex-1 flex-col justify-center py-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-gold">
            Your workspace
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Where would you like to go?
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/60">
            {canTest
              ? "Your beta is ready to explore. Open your owner dashboard, or try the agency and client experiences using your test accounts."
              : "Choose a workspace to get started. Sign in with the email connected to your account."}
          </p>
          <nav
            aria-label="Choose a workspace"
            className="mt-10 grid gap-4 md:grid-cols-3"
          >
            {workspaces.map(
              ({ title, layer, audience, description, href, icon: Icon }) => {
                const className =
                  "group flex h-full w-full flex-col items-start rounded-2xl border border-white/15 bg-white/5 p-7 text-left transition-colors hover:border-brand-gold/60 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-gold";
                const content = (
                  <>
                    <Icon
                      aria-hidden="true"
                      className="size-7 text-brand-gold"
                    />
                    <span className="mt-7 text-xs text-white/50">
                      {audience}
                    </span>
                    <span className="mt-1 text-2xl font-semibold">{title}</span>
                    <span className="mb-8 mt-3 flex-1 text-sm leading-6 text-white/60">
                      {description}
                    </span>
                    {canTest && layer !== "owner" ? (
                      <span className="mb-4 text-xs text-white/50">
                        {layer === "partner"
                          ? "Test agency · start with guided setup"
                          : "Sample Home Services · sample customers and tasks"}
                      </span>
                    ) : null}
                    <span className="flex w-full items-center justify-between text-sm font-medium text-brand-gold">
                      {canTest && layer !== "owner"
                        ? "Open test workspace"
                        : "Open workspace"}{" "}
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 transition-transform group-hover:translate-x-1"
                      />
                    </span>
                  </>
                );
                return canTest && layer !== "owner" ? (
                  <form key={href} action={openTestWorkspace.bind(null, layer)}>
                    <button type="submit" className={className}>
                      {content}
                    </button>
                  </form>
                ) : (
                  <Link key={href} href={href} className={className}>
                    {content}
                  </Link>
                );
              },
            )}
          </nav>
          <p className="mt-6 text-sm leading-6 text-white/45">
            {canTest
              ? "Changes in the test workspaces are saved. Use Choose workspace at the top to return here. Live calls, AI providers, and connected apps need setup before you can test them end to end."
              : "Use the email connected to your account to access your workspace."}
          </p>
        </section>
        <footer className="py-4 text-xs text-white/35">
          One platform. Your agency. Your clients.
        </footer>
      </div>
    </main>
  );
}
