import Link from "next/link";
import {
  ArrowRight,
  Check,
  Layers3,
  Megaphone,
  Search,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { NorthstarMark } from "@/components/brand/northstar-mark";
import { getAuthState } from "@/lib/auth/session";
import { isAccessError, requirePlatformRole } from "@/lib/permissions/access";
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
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <NorthstarMark
            surface="light"
            subtitle="Your business, working together"
          />
          <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            Business workspace · Prototype
          </span>
        </header>
        <section className="grid min-h-[75vh] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              More time for the business you love
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Your next chapter.
              <br />
              <span className="text-primary">A little less busy.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground">
              One place for your customers, marketing, purchasing, and everyday
              operations. Choose what gets handled. Stay in charge of the
              decisions.
            </p>
            <div className="mt-8">
              <Link
                href={
                  user
                    ? "/workspaces/client"
                    : "/login?next=%2Fworkspaces%2Fclient"
                }
                className="inline-flex items-center gap-4 rounded-xl bg-primary px-6 py-3.5 text-sm font-medium text-white"
              >
                {user ? "Open your business" : "Sign in to your business"}
                <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {[
                "Shared business records",
                "Approvals on your phone",
                "Your tools, connected",
              ].map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <Check className="size-3 text-primary" />
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-3 border-b pb-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">Built around your business</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start with the work that matters to you.
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-5">
              {[
                {
                  name: "Marketing",
                  text: "Prepare campaigns and useful content.",
                  icon: Megaphone,
                },
                {
                  name: "Sourcing",
                  text: "Compare suppliers and buying opportunities.",
                  icon: Search,
                },
                {
                  name: "Purchasing",
                  text: "Plan, approve, and track what you buy.",
                  icon: ShoppingBag,
                },
                {
                  name: "Operations",
                  text: "Keep jobs, people, and next steps together.",
                  icon: Layers3,
                },
              ].map((item) => (
                <div key={item.name} className="flex items-center gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                    <item.icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{item.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-7 border-t pt-5 text-xs leading-6 text-muted-foreground">
              Describe your business, see your recommended capabilities, and
              connect the tools you need.
            </p>
          </div>
        </section>
        <footer className="flex flex-wrap justify-between gap-3 border-t py-5 text-xs text-muted-foreground">
          <span>A single workspace for the work of running a business.</span>
          {canTest ? (
            <div className="flex gap-5">
              <Link href="/control">Account administration</Link>
              <Link href="/partner">Partner administration</Link>
            </div>
          ) : null}
        </footer>
      </div>
    </main>
  );
}
