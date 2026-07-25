import Link from "next/link";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  PlugZap,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AutomationPack } from "@/lib/automation-packs/catalog";

export function AutomationPackLibrary({
  packs,
  activeTemplateKeys,
  inboundEndpoint,
  integrationsPath,
  testCenterPath,
}: {
  packs: AutomationPack[];
  activeTemplateKeys: string[];
  inboundEndpoint: string | null;
  integrationsPath: string;
  testCenterPath: string;
}) {
  const active = new Set(activeTemplateKeys);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PlugZap className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Automation packs</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Built-in Northstar workflows plus concrete n8n, Make, and Zapier
            assets. Partners can install these in a client&apos;s automation
            account and every action remains visible in Northstar logs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={integrationsPath}>Webhook connection</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={testCenterPath}>Run package tests</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        {packs.map((pack) => {
          const enabled = pack.workflowTemplates.every((key) => active.has(key));

          return (
            <article key={pack.key} className="rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant="outline">{pack.category}</Badge>
                  <h2 className="mt-2 font-semibold">{pack.name}</h2>
                </div>
                <Badge
                  variant="outline"
                  className={
                    enabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }
                >
                  {enabled ? (
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                  ) : (
                    <Workflow className="size-3" aria-hidden="true" />
                  )}
                  {enabled ? "Built-in active" : "Enable workflows"}
                </Badge>
              </div>

              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {pack.description}
              </p>

              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-muted-foreground">Trigger</dt>
                  <dd className="mt-1 font-mono">{pack.eventType}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Outcome</dt>
                  <dd className="mt-1 leading-5">{pack.outcome}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/automation-packs/${pack.key}/n8n`}>
                    <Download aria-hidden="true" />
                    n8n workflow
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/automation-packs/${pack.key}/make`}>
                    <Download aria-hidden="true" />
                    Make blueprint
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/automation-packs/${pack.key}/zapier`}>
                    <Download aria-hidden="true" />
                    Zapier recipe
                  </a>
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">Client webhook destination</h2>
        </div>
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            {inboundEndpoint ? (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  POST destination
                </p>
                <code className="mt-2 block overflow-x-auto rounded-md bg-secondary p-3 text-xs">
                  {inboundEndpoint}
                </code>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Add the one-time connection credential as{" "}
                  <code>x-webhook-token</code>. Tokens are never displayed
                  again after creation; rotate the connection if it was lost.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  No inbound automation bridge is connected.
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Create the Zapier / Make / n8n bridge under Integrations, then
                  paste its URL and token into the downloaded asset.
                </p>
              </>
            )}
          </div>
          <div className="rounded-md bg-secondary/60 p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Partner workflow
            </p>
            <ol className="mt-2 space-y-2 text-xs leading-5">
              <li>1. Download the client&apos;s preferred format.</li>
              <li>2. Import it into n8n or Make, or follow the Zapier recipe.</li>
              <li>3. Paste this client&apos;s URL and token.</li>
              <li>4. Map the source fields and send a test event.</li>
              <li>5. Verify every step in Health &amp; Logs.</li>
            </ol>
          </div>
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ExternalLink className="size-3.5" aria-hidden="true" />
        These exports use generic platform nodes so they do not require a
        proprietary Northstar marketplace app.
      </p>
    </div>
  );
}

