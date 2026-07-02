import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  DatabaseZap,
  KeyRound,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const readinessItems = [
  {
    label: "Secure access",
    detail:
      "Partner, client, and platform users enter through the same auth-ready boundary.",
    icon: KeyRound,
  },
  {
    label: "Partner workspace",
    detail: "Navigation is organized around client operations and tenant-scoped work.",
    icon: ShieldCheck,
  },
  {
    label: "Operational visibility",
    detail:
      "The shell is ready for integrations, workflows, approvals, runs, and reports.",
    icon: Workflow,
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">
              Partner Operations
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal text-foreground">
              Partner Portal
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Manage client integrations, workflow operations, approval queues,
              and operational health from a partner-branded workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login">
                <KeyRound aria-hidden="true" />
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/partner">
                <Activity aria-hidden="true" />
                Partner area
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {readinessItems.map((item) => {
            const Icon = item.icon;

            return (
              <Card key={item.label}>
                <CardHeader>
                  <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{item.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.detail}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <DatabaseZap className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Operations entry</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Sign in to reach the partner workspace. Client records,
                  connection health, workflow runs, and approvals remain scoped
                  to authenticated access.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-1 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-lg font-semibold">Partner area</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The protected workspace is ready for partner tenancy,
                  memberships, and audit-backed operations.
                </p>
                <Button asChild variant="link" className="mt-3 h-auto px-0">
                  <Link href="/partner">
                    Open partner area
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
