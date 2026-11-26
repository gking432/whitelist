"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Pause,
  Play,
  PlugZap,
  Sparkles,
} from "lucide-react";
import {
  BUSINESS_RECIPES,
  recommendRecipes,
  type Recipe,
} from "@/lib/business/catalog";
import type { BusinessSnapshot } from "@/lib/business/types";
import {
  BusinessDialog,
  buttonClass,
  inputClass,
  secondaryClass,
} from "./record-editor";
export function Capabilities({
  snapshot,
  busy,
  onMutation,
  compact = false,
}: {
  snapshot: BusinessSnapshot;
  busy: boolean;
  onMutation: (input: unknown) => Promise<boolean>;
  compact?: boolean;
}) {
  const [category, setCategory] = useState("All");
  const [run, setRun] = useState<Recipe | null>(null);
  const runRequestKey = useRef<string | null>(null);
  const [error, setError] = useState("");
  const recommendations = recommendRecipes(snapshot.profile);
  const recipes = (
    compact ? recommendations.slice(0, 3) : recommendations
  ).filter(({ recipe }) => category === "All" || recipe.area === category);
  return (
    <div className="space-y-5">
      {!compact ? (
        <div className="flex flex-wrap gap-2">
          {["All", ...new Set(BUSINESS_RECIPES.map((r) => r.area))].map(
            (area) => (
              <button
                key={area}
                onClick={() => setCategory(area)}
                className={`rounded-full border px-4 py-2 text-xs font-medium ${category === area ? "bg-primary text-white" : "bg-card hover:bg-secondary"}`}
              >
                {area}
              </button>
            ),
          )}
        </div>
      ) : null}
      <div
        className={`grid gap-4 ${compact ? "xl:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-3"}`}
      >
        {recipes.map(({ recipe, reason, score }) => {
          const install = snapshot.installs.find(
            (i) => i.recipe_key === recipe.key,
          );
          const enabled = install?.status === "enabled";
          return (
            <article
              key={recipe.key}
              className="flex flex-col rounded-2xl border bg-card p-5 transition hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
                  <Sparkles className="size-5" />
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${enabled ? "bg-emerald-50 text-emerald-800" : "bg-secondary text-muted-foreground"}`}
                >
                  {enabled
                    ? "Enabled"
                    : recipe.mode === "connection"
                      ? "Connection setup"
                      : score > 1
                        ? "Recommended"
                        : "Available"}
                </span>
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {recipe.area}
              </p>
              <h3 className="mt-1 font-semibold">{recipe.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                {recipe.description}
              </p>
              {score > 1 ? (
                <p className="mt-3 text-xs leading-5 text-primary">{reason}</p>
              ) : null}
              <div className="my-4 border-t pt-4">
                <p className="text-xs font-medium">What you get</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {recipe.outcome}
                </p>
              </div>
              {recipe.mode === "connection" ? (
                <Link href="/client/integrations" className={secondaryClass}>
                  <PlugZap className="size-4" />
                  Set up connection
                </Link>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {enabled ? (
                    <>
                      <button
                        disabled={busy || !snapshot.canWrite}
                        onClick={() => {
                          setRun(recipe);
                          runRequestKey.current = crypto.randomUUID();
                          setError("");
                        }}
                        className={`${buttonClass} flex-1`}
                      >
                        <Play className="size-3.5" />
                        Run now
                      </button>
                      <button
                        aria-label={`Pause ${recipe.name}`}
                        title="Pause capability"
                        disabled={busy || !snapshot.canWrite}
                        onClick={() =>
                          void onMutation({
                            action: "install",
                            recipeKey: recipe.key,
                            enabled: false,
                          })
                        }
                        className={secondaryClass}
                      >
                        <Pause className="size-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={
                        busy || !snapshot.canWrite || Boolean(snapshot.error)
                      }
                      onClick={() =>
                        void onMutation({
                          action: "install",
                          recipeKey: recipe.key,
                          enabled: true,
                        })
                      }
                      className={`${secondaryClass} w-full`}
                    >
                      <Check className="size-4" />
                      Enable capability
                    </button>
                  )}
                </div>
              )}
              {enabled && recipe.schedule ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={install.schedule_enabled}
                    disabled={busy || !snapshot.canWrite}
                    onChange={(e) =>
                      void onMutation({
                        action: "install",
                        recipeKey: recipe.key,
                        enabled: true,
                        schedule: e.target.checked,
                      })
                    }
                  />
                  <Clock3 className="size-3" />
                  Prepare a daily update
                </label>
              ) : null}
            </article>
          );
        })}
      </div>
      {!compact ? (
        <p className="text-xs leading-6 text-muted-foreground">
          Workspace capabilities prepare saved drafts, plans, and internal work.
          Publishing, sending, and supplier orders require the relevant
          connection or a recorded manual action. Daily runs depend on the
          background job service.
        </p>
      ) : null}
      {run ? (
        <BusinessDialog title={run.name} onClose={() => setRun(null)}>
          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              const form = new FormData(event.currentTarget);
              const ok = await onMutation({
                action: "run",
                recipeKey: run.key,
                brief: String(form.get("brief") ?? ""),
                sourceId: form.get("sourceId") || undefined,
                requestKey: (runRequestKey.current ??= crypto.randomUUID()),
              });
              if (ok) setRun(null);
              else
                setError(
                  "The run could not finish. Check your business records, connection, and capability status, then try again.",
                );
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              {run.inputs}
            </p>
            <ol className="grid gap-3 sm:grid-cols-2">
              {run.steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-xs leading-5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            {["listing-assistant", "payment-followup"].includes(run.key) ? (
              <label className="block space-y-2 text-sm font-medium">
                {run.key === "listing-assistant"
                  ? "Product to describe"
                  : "Invoice to follow up"}
                <select
                  name="sourceId"
                  required
                  defaultValue=""
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select a record
                  </option>
                  {snapshot.records
                    .filter(
                      (r) =>
                        r.status !== "archived" &&
                        (run.key === "listing-assistant"
                          ? r.kind === "product"
                          : r.kind === "invoice" && r.status !== "paid"),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                        {r.kind === "invoice" ? ` · ${r.data.customer}` : ""}
                      </option>
                    ))}
                </select>
                <span className="block text-xs font-normal text-muted-foreground">
                  Only this record is included in the draft.
                </span>
              </label>
            ) : null}
            <label className="block space-y-2 text-sm font-medium">
              Your brief {run.schedule ? "(optional)" : ""}
              <textarea
                name="brief"
                rows={5}
                className={inputClass}
                required={
                  !run.schedule &&
                  !["listing-assistant", "payment-followup"].includes(run.key)
                }
                maxLength={10000}
                placeholder="What should this work achieve? Include the facts and any constraints."
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {snapshot.aiConfigured
                ? "AI drafting is configured. Output is saved for your review."
                : "AI drafting is not connected. You can use the built-in templates and record-based planning now."}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button className={buttonClass} disabled={busy}>
                {busy ? "Preparing your work…" : "Prepare & save"}
                <ArrowRight className="size-4" />
              </button>
            </div>
          </form>
        </BusinessDialog>
      ) : null}
    </div>
  );
}
