import Link from "next/link";
import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";

import { resolvePlatformError } from "@/app/control/errors/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Platform Errors" };
export const dynamic = "force-dynamic";

export default async function PlatformErrorsPage() {
  const user = await requireAuthenticatedUser("/control/errors");
  await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("platform_error_events")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(100);
  const errors = data ?? [];
  const unresolved = errors.filter((item) => !item.resolved_at);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="px-0">
        <Link href="/control">
          <ArrowLeft aria-hidden="true" />
          Control Room
        </Link>
      </Button>
      <header>
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Platform errors</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Sanitized server, browser, desktop, voice, and worker failures grouped
          by fingerprint.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-2xl font-semibold">{unresolved.length}</p>
          <p className="text-xs text-muted-foreground">
            Unresolved error groups
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-2xl font-semibold">
            {unresolved.reduce(
              (sum, item) => sum + Number(item.occurrence_count),
              0,
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Unresolved occurrences
          </p>
        </div>
      </section>

      <section className="space-y-3">
        {errors.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <CheckCircle2
              className="mx-auto size-5 text-emerald-600"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium">
              No platform errors recorded
            </p>
          </div>
        ) : (
          errors.map((item) => (
            <article key={item.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {item.source.replaceAll("_", " ")}
                    </Badge>
                    <Badge variant="outline">{item.severity}</Badge>
                    {item.resolved_at ? (
                      <Badge variant="outline">resolved</Badge>
                    ) : null}
                  </div>
                  <h2 className="mt-3 text-sm font-semibold">{item.message}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.route_path ?? "No route"} · {item.occurrence_count}{" "}
                    occurrence{Number(item.occurrence_count) === 1 ? "" : "s"} ·
                    Last seen {new Date(item.last_seen_at).toLocaleString()}
                  </p>
                </div>
              </div>
              {item.stack_preview ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Technical details
                  </summary>
                  <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/60 p-3 text-xs leading-5">
                    {item.stack_preview}
                  </pre>
                </details>
              ) : null}
              {!item.resolved_at ? (
                <form
                  action={resolvePlatformError}
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                >
                  <input type="hidden" name="error_id" value={item.id} />
                  <Input
                    aria-label="Resolution note"
                    name="resolution_note"
                    maxLength={1000}
                    placeholder="Resolution note"
                  />
                  <Button type="submit" size="sm">
                    Resolve
                  </Button>
                </form>
              ) : item.resolution_note ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Resolution: {item.resolution_note}
                </p>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
