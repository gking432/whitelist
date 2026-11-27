"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, RefreshCw } from "lucide-react";
import type { ManagerChatSnapshot } from "@/lib/agents/manager-chat";
import type { BusinessContextSnapshot } from "@/lib/business/context-contract";
import { fetchBusinessContext, isDirectManagerControl, sendBusinessContextCommand } from "@/components/business/context-client";
import {
  OwnerAreaHeader,
  ownerQuietButton,
} from "@/components/business/owner-ui";

const pendingLabels: Record<string, string> = {
  queued: "Waiting to run.",
  running: "Working on this.",
  waiting_children: "Waiting for assigned work.",
  waiting_approval: "Waiting for your approval.",
};

export function BusinessManagerChat({
  initialSnapshot,
  preview = false,
}: {
  initialSnapshot: ManagerChatSnapshot;
  preview?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [context, setContext] = useState<BusinessContextSnapshot | null>(null);
  const [controlError, setControlError] = useState("");
  const pending = useRef<{ text: string; key: string; revision?: number } | null>(null);
  const generation = useRef(0),
    inFlight = useRef(false);
  const controlGeneration = useRef(0);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const refreshControls = useCallback(async (signal?: AbortSignal) => {
    if (preview || inFlight.current) return;
    const version = ++controlGeneration.current;
    try {
      const data = await fetchBusinessContext(fetch, signal);
      if (!signal?.aborted && !inFlight.current && version === controlGeneration.current) {
        setContext(data);
        setControlError("");
      }
    } catch (cause) {
      if (!signal?.aborted && version === controlGeneration.current) setControlError(cause instanceof Error ? cause.message : "Manager controls could not be loaded.");
    }
  }, [preview]);
  const refresh = useCallback(async () => {
    if (preview) return;
    if (inFlight.current) return;
    const version = ++generation.current;
    try {
      const response = await fetch("/api/agents/manager", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Chat could not be refreshed.");
      if (version === generation.current && !inFlight.current) {
        setSnapshot(result);
        setError("");
      }
    } catch (cause) {
      if (version === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Chat could not be refreshed.",
        );
    }
  }, [preview]);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const version = ++controlGeneration.current;
    void fetchBusinessContext(fetch, controller.signal).then((data) => {
      if (!controller.signal.aborted && !inFlight.current && version === controlGeneration.current) setContext(data);
    }).catch((cause) => {
      if (!controller.signal.aborted && version === controlGeneration.current) setControlError(cause instanceof Error ? cause.message : "Manager controls could not be loaded.");
    });
    return () => controller.abort();
  }, [preview]);
  useEffect(() => {
    if (preview) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, preview]);
  useEffect(() => {
    if (snapshot.messages.length)
      scrollEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [snapshot.messages.length]);

  const active = snapshot.active && (!context || context.authority.status === "active");
  async function send(instruction?: string) {
    if (preview) return;
    const text = (instruction ?? draft).trim();
    const directControl = isDirectManagerControl(text);
    if (
      inFlight.current ||
      !snapshot.canWrite ||
      (!active && !directControl) ||
      text.length < 5
    )
      return;
    if (directControl && !context) {
      setControlError("Load the current permissions before changing them. Use Refresh controls to try again.");
      return;
    }
    if (pending.current?.text !== text)
      pending.current = { text, key: crypto.randomUUID(), revision: context?.authority.revision };
    inFlight.current = true;
    generation.current++;
    controlGeneration.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (directControl) {
        const data = await sendBusinessContextCommand({
          action: "manager_control",
          key: pending.current.key,
          expectedRevision: pending.current.revision!,
          command: text,
        });
        setContext(data.snapshot);
        setSnapshot((current) => ({ ...current, active: data.snapshot.authority.status === "active" }));
        setNotice(data.result.replayed ? `Previously saved: ${data.result.message} Check Owner controls for the current team state.` : data.result.message);
        setControlError("");
        if (!instruction) setDraft("");
        pending.current = null;
        return;
      }
      const response = await fetch("/api/agents/manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request",
          request: text,
          key: pending.current.key,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Message could not be sent.");
      setSnapshot(result.snapshot);
      setDraft("");
      pending.current = null;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Message could not be sent.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const canSend = snapshot.canWrite && (active || isDirectManagerControl(draft));
  return (
    <div className="flex min-h-[65dvh] flex-col">
      <OwnerAreaHeader title="Agents">
        <button
          type="button"
          onClick={() => { pending.current = null; void refresh(); void refreshControls(); }}
          className={ownerQuietButton}
          aria-label="Refresh manager chat"
          disabled={busy || preview}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </OwnerAreaHeader>
      <div className="mt-5 flex flex-wrap items-center gap-5 text-xs text-slate-500">
        {!preview ? <Link href="/client/customer-work" className="hover:text-slate-800">Customer work & outcomes</Link> : null}
        <Link
          href={preview ? "/preview/apps" : "/client/team"}
          className="hover:text-slate-800"
        >
          Agent settings
        </Link>
        {!active ? (
          <Link
            href={preview ? "/preview/apps" : "/client/activate"}
            className="hover:text-slate-800"
          >
            Review setup · assignments are paused
          </Link>
        ) : !snapshot.aiConfigured ? (
          <span>
            Basic reviews available. Open-ended chat needs AI connected.
          </span>
        ) : null}
      </div>
      {!preview ? <details className="mt-5 rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">Owner controls · {active ? "team active" : "team paused"}</summary>
        <p className="mt-3 text-xs leading-6 text-slate-500">These saved controls work while assignments are paused. Stopping a channel also stops eligible unsent work. Completed or uncertain provider actions remain in history.</p>
        {controlError ? <p role="alert" className="mt-3 text-xs text-red-700">{controlError}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ownerQuietButton} disabled={busy} onClick={() => { pending.current = null; void refreshControls(); }}>Refresh controls</button>
          {context ? <>
            <button type="button" className={ownerQuietButton} disabled={busy || !snapshot.canWrite} onClick={() => void send(active ? "pause team" : "resume team")}>{active ? "Pause team" : "Resume team"}</button>
            {(["Instagram", "email", "SMS", "website", "calendar"] as const).map((channel) => <button key={channel} type="button" className={ownerQuietButton} disabled={busy || !snapshot.canWrite} onClick={() => void send(`stop using ${channel}`)}>Stop {channel}</button>)}
          </> : null}
          <Link href="/client/onboarding" className={ownerQuietButton}>Review facts & authority</Link>
        </div>
      </details> : null}
      <div
        className="flex-1 space-y-8 py-9"
        aria-label="Private conversation with your manager"
      >
        {snapshot.messages.map((message) => (
          <div key={message.id} className="space-y-4">
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-800">
              {message.request}
            </div>
            <div className="max-w-[95%] text-sm leading-7 text-slate-700">
              <p className="whitespace-pre-wrap break-words">
                {message.summary ||
                  pendingLabels[message.status] ||
                  "No response has been recorded."}
              </p>
              {message.assignments.length ? (
                <div className="mt-4 space-y-3 border-l border-slate-200 pl-4">
                  {message.assignments.map((item) => (
                    <Link
                      key={item.id}
                      href={`/client/team#work-${item.id}`}
                      className="block text-xs text-slate-600 hover:text-slate-900"
                    >
                      <span>{item.title}</span>
                      <span className="ml-2 text-[11px] text-slate-500">
                        {item.status.replaceAll("_", " ")}
                      </span>
                      {item.summary ? (
                        <span className="mt-1 block leading-6">
                          {item.summary}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null}
              {message.status === "blocked" ? (
                <Link
                  href={`/client/team#work-${message.id}`}
                  className="mt-2 inline-block text-xs text-slate-500 underline"
                >
                  Review request
                </Link>
              ) : null}
            </div>
          </div>
        ))}
        {snapshot.hasMore ? (
          <p className="text-center text-xs text-slate-500">
            Your 50 most recent requests.
          </p>
        ) : null}
        <div ref={scrollEnd} />
      </div>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status" className="mb-4 text-sm text-slate-700">{notice}</p> : null}
      <form
        className="sticky bottom-5 rounded-xl border border-slate-200 bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="manager-message" className="sr-only">
          Message your manager
        </label>
        <textarea
          id="manager-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={2000}
          disabled={!snapshot.canWrite || busy}
          placeholder={active ? "Ask about your business or give an instruction…" : "Team paused. Type ‘resume team’ or use Owner controls."}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-7 outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3 px-2">
          <span className="text-[11px] text-slate-500">
            Private to you and your manager.
          </span>
          <button
            type="submit"
            disabled={!canSend || busy || draft.trim().length < 5}
            aria-label="Send message"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
