import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  KeyRound,
  Phone,
  Rocket,
  ServerCog,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { platformActivation } from "@/lib/ops/platform-activation";
import { loadRuntimeActivation } from "@/lib/ops/runtime-activation";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Production Activation" };
export const dynamic = "force-dynamic";

export default async function ProductionActivationPage() {
  const user = await requireAuthenticatedUser("/control/activation");
  await requirePlatformRole(user.id, ["platform_owner", "platform_admin"]);
  const activation = platformActivation();
  const runtime = await loadRuntimeActivation(createSupabaseAdminClient());
  const appUrl = getAppUrl();

  return (
    <div className="min-w-0">
      <div className="space-y-6">
        <section className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Rocket className="size-5 text-primary" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Activate production</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              This page separates required account configuration from live proof
              that the deployed system is operating. No secret value is exposed.
            </p>
          </div>
          <div className="grid min-w-64 grid-cols-2 divide-x rounded-lg border bg-card">
            <div className="px-4 py-3">
              <p className="text-2xl font-semibold tabular-nums">
                {activation.coreComplete}/{activation.coreTotal}
              </p>
              <p className="text-xs text-muted-foreground">Configured</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-2xl font-semibold tabular-nums">
                {runtime.complete}/{runtime.total}
              </p>
              <p className="text-xs text-muted-foreground">Runtime proven</p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ServerCog className="size-4 text-primary" aria-hidden="true" />
                <h2 className="font-semibold">Live runtime evidence</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Checked {new Date(runtime.checkedAt).toLocaleString()}. These
                checks read deployed services and production records; they are
                not inferred from environment variables.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                runtime.ready
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }
            >
              {runtime.ready ? "Runtime verified" : "Runtime action required"}
            </Badge>
          </div>
          <div className="divide-y">
            {runtime.items.map((item) => {
              const ready = item.state === "ready";
              const Icon = ready ? CheckCircle2 : CircleDashed;
              return (
                <div
                  key={item.key}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] sm:items-start"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon
                        className={`size-4 ${
                          ready
                            ? "text-emerald-700"
                            : item.state === "attention"
                              ? "text-amber-700"
                              : "text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      />
                      <p className="text-sm font-semibold">{item.label}</p>
                      <Badge variant="outline">
                        {ready
                          ? "Verified"
                          : item.state === "attention"
                            ? "Action required"
                            : item.required
                              ? "Waiting"
                              : "Pilot pending"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {item.purpose}
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
          <div className="flex gap-3">
            <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">
                Twilio is configured by each partner
              </p>
              <p className="mt-1 text-xs leading-5">
                You do not enter a shared Twilio key here. Partner onboarding
                connects that agency&apos;s Twilio parent account; client setup
                provisions isolated subaccounts and numbers beneath it.
              </p>
            </div>
          </div>
        </section>

        {activation.groups.map((group) => (
          <section
            key={group.key}
            className="overflow-hidden rounded-lg border bg-card"
          >
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">{group.label}</h2>
            </div>
            <div className="divide-y">
              {group.items.map((item) => {
                const Icon = item.configured ? CheckCircle2 : CircleDashed;
                return (
                  <div
                    key={item.key}
                    className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon
                          className={`size-4 ${item.configured ? "text-emerald-700" : "text-amber-700"}`}
                          aria-hidden="true"
                        />
                        <p className="text-sm font-semibold">{item.label}</p>
                        <Badge variant="outline">
                          {item.configured
                            ? "Configured"
                            : item.required
                              ? "Required"
                              : "Add when sold"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {item.purpose}
                      </p>
                      {item.environmentKeys?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.environmentKeys.map((key) => (
                            <code
                              key={key}
                              className="rounded border bg-secondary px-1.5 py-1 text-[11px]"
                            >
                              {key}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0 space-y-2">
                      {item.callbackPaths?.map((path) => (
                        <div
                          key={path}
                          className="flex min-w-0 items-start gap-2 rounded-md border bg-background px-3 py-2"
                        >
                          <KeyRound
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <code className="min-w-0 break-all text-[11px] leading-5">
                            {appUrl}
                            {path}
                          </code>
                        </div>
                      ))}
                      {item.accountUrl ? (
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={item.accountUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open account setup
                            <ExternalLink aria-hidden="true" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
