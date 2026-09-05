import Link from "next/link";
import {
  ArrowRight,
  BellCheck,
  CalendarClock,
  KeyRound,
  PhoneCall,
  ScrollText,
  Workflow,
} from "lucide-react";

import { NorthstarMark } from "@/components/brand/northstar-mark";
import { Button } from "@/components/ui/button";

const capabilities = [
  {
    icon: PhoneCall,
    label: "AI voice",
    detail: "Help answer calls and follow up with new leads.",
  },
  {
    icon: CalendarClock,
    label: "AI scheduling",
    detail: "Help customers find appointment times in connected calendars.",
  },
  {
    icon: Workflow,
    label: "AI workflows",
    detail:
      "Lead analysis, follow-up drafts, and reminders that run on your clients' events.",
  },
  {
    icon: BellCheck,
    label: "Client approvals",
    detail:
      "Customer-facing actions pause for a human decision. Nothing sends silently.",
  },
  {
    icon: ScrollText,
    label: "Clear activity history",
    detail:
      "See what happened, what needs attention, and who approved each action.",
  },
];

export default function HomePage() {
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

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <NorthstarMark subtitle="AI Operations Platform" />
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Link href="/client">Client portal</Link>
            </Button>
            <Button asChild variant="gold">
              <Link href="/login">
                <KeyRound aria-hidden="true" />
                Sign in
              </Link>
            </Button>
          </div>
        </header>

        <section className="ns-fade-up flex flex-1 flex-col justify-center py-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-gold">
            For partners &amp; agencies
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Build your AI agency. Make it your own.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/60">
            Offer phone assistants, scheduling, follow-ups, and automations
            under your own brand. Connect each client’s existing tools and
            manage their solutions from one workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="gold">
              <Link href="/partner">
                Open partner workspace
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>

        <section
          aria-label="Platform capabilities"
          className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5"
        >
          {capabilities.map((capability) => {
            const Icon = capability.icon;

            return (
              <div
                key={capability.label}
                className="bg-brand-deep/80 p-5 backdrop-blur"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/8 text-brand-gold">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-medium">{capability.label}</p>
                <p className="mt-1.5 text-[13px] leading-5 text-white/50">
                  {capability.detail}
                </p>
              </div>
            );
          })}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 py-6 text-[11px] text-white/35">
          <p>Northstar — white-label AI operations.</p>
          <p>Clients see your brand. Homeowners see theirs.</p>
        </footer>
      </div>
    </main>
  );
}
