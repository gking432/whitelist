import Link from "next/link";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  Download,
  ExternalLink,
  Laptop,
  PlugZap,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import {
  AutomationPackControls,
  AutomationStackControls,
} from "@/components/automations/automation-pack-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AutomationPack } from "@/lib/automation-packs/catalog";
import type {
  AutomationPackInstallRecord,
  AutomationInstallStatus,
} from "@/lib/automation-packs/install";

const STATUS_META: Record<
  AutomationInstallStatus,
  { label: string; className: string }
> = {
  installing: {
    label: "Installing",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  needs_setup: {
    label: "Accounts needed",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  ready_to_test: {
    label: "Ready to test",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  active: {
    label: "Verified active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  paused: {
    label: "Paused",
    className: "border-border bg-secondary text-muted-foreground",
  },
  failed: {
    label: "Install failed",
    className: "border-red-200 bg-red-50 text-red-800",
  },
};

function PackCard({
  pack,
  install,
  clientId,
  canManage,
}: {
  pack: AutomationPack;
  install: AutomationPackInstallRecord | null;
  clientId: string;
  canManage: boolean;
}) {
  const status = install?.status ?? null;
  const statusMeta = status ? STATUS_META[status] : null;
  const missing = new Set(install?.missing_connection_keys ?? []);

  return (
    <article className="flex h-full flex-col rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{pack.category}</Badge>
            <span className="text-xs text-muted-foreground">
              Priority {pack.priority}
            </span>
          </div>
          <h2 className="mt-2 font-semibold">{pack.name}</h2>
        </div>
        {statusMeta ? (
          <Badge variant="outline" className={statusMeta.className}>
            {status === "active" ? (
              <CheckCircle2 className="size-3" aria-hidden="true" />
            ) : (
              <CircleDashed className="size-3" aria-hidden="true" />
            )}
            {statusMeta.label}
          </Badge>
        ) : (
          <Badge variant="outline">Available</Badge>
        )}
      </div>

      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {pack.description}
      </p>

      <div className="mt-4 grid gap-3 border-y py-4 text-xs sm:grid-cols-2">
        <div>
          <p className="font-medium text-muted-foreground">Starts when</p>
          <p className="mt-1 font-mono">{pack.eventType}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">Runs through</p>
          <p className="mt-1 capitalize">
            {pack.platforms.join(" + ")}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">
          Required accounts
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {pack.connectionRequirements.length > 0 ? (
            pack.connectionRequirements.map((requirement) => {
              const isMissing = missing.has(requirement.key);

              return (
                <span
                  key={requirement.key}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                    isMissing
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : install
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "bg-secondary/50 text-muted-foreground"
                  }`}
                >
                  {install && !isMissing ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : (
                    <PlugZap className="size-3" aria-hidden="true" />
                  )}
                  {requirement.label}
                </span>
              );
            })
          ) : (
            <span className="text-xs text-muted-foreground">
              No external account required
            </span>
          )}
          {pack.staffRuntime === "northstar_desktop" ? (
            <span className="inline-flex items-center gap-1.5 rounded border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground">
              <Laptop className="size-3" aria-hidden="true" />
              Desktop assistant
            </span>
          ) : null}
        </div>
      </div>

      {install && status !== "active" ? (
        <div className="mt-4 rounded-md bg-secondary/50 p-3">
          <p className="text-xs font-semibold">Real verification</p>
          <ol className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
            {pack.testInstructions.map((instruction, index) => (
              <li key={instruction}>
                {index + 1}. {instruction}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {install?.last_error ? (
        <p className="mt-3 text-xs leading-5 text-destructive">
          {install.last_error}
        </p>
      ) : null}

      <div className="mt-auto pt-4">
        <AutomationPackControls
          clientId={clientId}
          packKey={pack.key}
          status={status}
          canManage={canManage}
        />
      </div>
    </article>
  );
}

export function AutomationPackLibrary({
  packs,
  installs,
  clientId,
  canManage,
  inboundEndpoint,
  integrationsPath,
}: {
  packs: AutomationPack[];
  installs: AutomationPackInstallRecord[];
  clientId: string;
  canManage: boolean;
  inboundEndpoint: string | null;
  integrationsPath: string;
}) {
  const installByKey = new Map(
    installs.map((install) => [install.pack_key, install]),
  );
  const launchPacks = packs
    .filter((pack) => pack.launchScope === "v1")
    .sort((left, right) => left.priority - right.priority);
  const nextPacks = packs
    .filter((pack) => pack.launchScope === "next")
    .sort((left, right) => left.priority - right.priority);
  const activeCount = installs.filter(
    (install) => install.status === "active",
  ).length;

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PlugZap className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Automation installer</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Connect the client&apos;s accounts once, install the selected packs,
            then verify each one with a real customer event.
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-3">
          <div className="text-right text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">
              {activeCount}/{launchPacks.length} verified
            </p>
            <p>Launch packs</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={integrationsPath}>Connected accounts</Link>
          </Button>
          <AutomationStackControls
            clientId={clientId}
            installedCount={installs.filter((install) =>
              launchPacks.some((pack) => pack.key === install.pack_key),
            ).length}
            totalCount={launchPacks.length}
            canManage={canManage}
          />
        </div>
      </header>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Launch packs</h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {launchPacks.map((pack) => (
            <PackCard
              key={pack.key}
              pack={pack}
              install={installByKey.get(pack.key) ?? null}
              clientId={clientId}
              canManage={canManage}
            />
          ))}
        </div>
      </section>

      <section className="border-t pt-6">
        <div className="mb-3 flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Next workflow packs</h2>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          {nextPacks.map((pack, index) => (
            <div
              key={pack.key}
              className={`grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center ${
                index > 0 ? "border-t" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{pack.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {pack.outcome}
                </p>
              </div>
              <p className="text-xs capitalize text-muted-foreground">
                {pack.platforms.join(" + ")}
              </p>
              <div className="flex gap-1">
                <Button asChild size="icon" variant="ghost" title="Download n8n workflow">
                  <a href={`/api/automation-packs/${pack.key}/n8n`}>
                    <Download aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild size="icon" variant="ghost" title="Download Zapier recipe">
                  <a href={`/api/automation-packs/${pack.key}/zapier`}>
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {inboundEndpoint ? (
        <section className="border-t pt-6">
          <p className="text-xs font-medium text-muted-foreground">
            Client automation destination
          </p>
          <code className="mt-2 block overflow-x-auto rounded-md border bg-secondary/50 p-3 text-xs">
            {inboundEndpoint}
          </code>
        </section>
      ) : null}
    </div>
  );
}
