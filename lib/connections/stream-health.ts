import type { ConnectedStream } from "./types.ts";
import { connectorCursorIsPartial } from "../integrations/connectors/read-only-policy.ts";

export type StreamHealthState = {
  cursor_value: Record<string, unknown> | null; last_completed_at: string | null;
  status: string; last_error: string | null;
};
export type StreamHealthJob = { status: string; updated_at?: string | null; completed_at?: string | null };
const timestamp = (value: string | null | undefined) => typeof value === "string" && value ? Date.parse(value) : NaN;

export function sourceCursorIsPartial(cursor: Record<string, unknown> | null): boolean {
  return connectorCursorIsPartial(cursor) || !!(cursor?.starting_after || cursor?.has_more === true);
}

/** Terminal history cannot undo a later completed scan. Missing clocks remain
 * attention-worthy; current failing stream state is independently authoritative. */
export function pullJobNeedsAttention(job: StreamHealthJob, lastCompletedAt: string | null | undefined): boolean {
  if (!["failed", "dead_letter"].includes(job.status)) return false;
  const completed = timestamp(lastCompletedAt);
  const times = [timestamp(job.updated_at), timestamp(job.completed_at)].filter(Number.isFinite);
  return !Number.isFinite(completed) || !times.length || Math.max(...times) >= completed;
}

/** Owner screens and manager evidence share source freshness. A bounded display
 * sample is coverage, while only actual queued page/running work is syncing. */
export function connectedStreamHealth(input: {
  key: string; generatedAt: string; eventBased: boolean; connectionStatus: string; paused: boolean;
  state?: StreamHealthState; jobs: StreamHealthJob[]; sampled?: boolean; metadataIncomplete?: boolean; metadataUnavailable?: boolean;
}): { stream: ConnectedStream; syncing: boolean } {
  const { state, jobs } = input, now = timestamp(input.generatedAt), completed = timestamp(state?.last_completed_at);
  const paged = sourceCursorIsPartial(state?.cursor_value ?? null);
  const paused = input.paused || state?.status === "paused";
  const error = input.metadataUnavailable || input.connectionStatus === "needs_attention" || !!state?.last_error || state?.status === "failing" || jobs.some((job) => pullJobNeedsAttention(job, state?.last_completed_at));
  const status: ConnectedStream["status"] = paused ? "paused" : error ? "error" : input.connectionStatus !== "connected" || !Number.isFinite(completed) ? "missing"
    : !Number.isFinite(now) || completed > now || (!input.eventBased && now - completed > 45 * 60_000) || paged || input.metadataIncomplete ? "stale" : "fresh";
  const partial = input.eventBased || paged || !!input.sampled || !!input.metadataIncomplete;
  const syncing = !paused && input.connectionStatus === "connected" && !error && (jobs.some((job) => job.status === "running") || paged && jobs.some((job) => job.status === "queued"));
  const detail = input.eventBased ? "Only received form events are available; earlier submissions and undelivered events are not established."
    : status === "fresh" ? partial ? "Recently synced; only a bounded sample is loaded." : "This stream completed recently within its supported import window."
      : status === "missing" ? "No complete import has been verified for this stream." : status === "paused" ? "Import is paused; saved records may be outdated."
        : status === "error" ? "This stream needs connection or import attention; its last completed import is retained." : "Import is delayed or still processing pages.";
  return { stream: { key: input.key, status, lastSyncedAt: Number.isFinite(completed) ? state!.last_completed_at : null, partial, detail }, syncing };
}
