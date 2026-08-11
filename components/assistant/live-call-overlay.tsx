"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  ChevronUp,
  ExternalLink,
  Maximize2,
  Minimize2,
  PhoneCall,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssistantContextData } from "@/lib/assistant/context";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    northstarDesktop?: {
      setCallActive: (active: boolean) => void;
      minimize: () => void;
      close: () => void;
    };
  }
}

type LiveCallOverlayProps = {
  standalone?: boolean;
  clientId?: string;
  productName?: string;
};

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-xs font-medium">
        {value || "Listening…"}
      </p>
    </div>
  );
}

export function LiveCallOverlay({
  standalone = false,
  clientId,
  productName = "Business",
}: LiveCallOverlayProps) {
  const [context, setContext] = useState<AssistantContextData | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [dismissedCallId, setDismissedCallId] = useState<string | null>(null);
  const latestCallId = useRef<string | null>(null);
  const activeCallRef = useRef(false);

  useEffect(() => {
    activeCallRef.current = Boolean(context?.call);
  }, [context?.call]);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const query = clientId
          ? `?client_id=${encodeURIComponent(clientId)}`
          : "";
        const response = await fetch(`/api/assistant/context${query}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          context?: AssistantContextData;
        };

        if (active && response.ok && body.context) {
          setContext(body.context);
        }
      } catch {
        // A brief network interruption should not close an active assistant.
      } finally {
        if (active) {
          timer = window.setTimeout(
            poll,
            activeCallRef.current ? 1_000 : 3_000,
          );
        }
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [clientId]);

  useEffect(() => {
    const callId = context?.call?.id ?? null;

    if (callId && callId !== latestCallId.current) {
      latestCallId.current = callId;
      setDismissedCallId(null);
      setExpanded(true);
    }

    window.northstarDesktop?.setCallActive(Boolean(callId));
  }, [context?.call?.id]);

  if (!context?.call) {
    if (!standalone) return null;

    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <PhoneCall className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-sm font-semibold">Phone assistant ready</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This window will come forward automatically when a connected
            business call begins.
          </p>
        </div>
      </main>
    );
  }

  if (!standalone && dismissedCallId === context.call.id) return null;

  const interaction = context.interaction;
  const transcript = context.transcript.slice(-8);
  const matchLabel =
    context.call.matchStatus === "matched"
      ? "Existing customer"
      : context.call.matchStatus === "created"
        ? "New lead created"
        : "Caller not identified";
  const assistantLabel =
    context.call.handlingMode === "staff_assisted"
      ? "Live staff assist"
      : "AI answering";

  if (!expanded && !standalone) {
    return createPortal(
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-5 right-5 z-[80] flex h-12 items-center gap-2 rounded-full border border-primary/30 bg-sidebar px-4 text-sm font-semibold text-white shadow-2xl"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
        Live call
        <ChevronUp className="size-4" aria-hidden="true" />
      </button>,
      document.body,
    );
  }

  const overlay = (
    <section
      className={cn(
        "z-[80] overflow-hidden border bg-card shadow-2xl",
        standalone
          ? "min-h-screen w-full"
          : "fixed bottom-5 right-5 max-h-[calc(100vh-2.5rem)] w-[min(440px,calc(100vw-2rem))] rounded-lg",
      )}
      aria-label="Live phone assistant"
    >
      <header className="flex items-start justify-between gap-3 bg-sidebar px-4 py-3 text-white">
        <div className="flex min-w-0 items-start gap-3">
          <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10">
            <span className="absolute size-9 animate-ping rounded-md bg-emerald-400/20" />
            <PhoneCall className="relative size-4 text-brand-gold" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{productName} assistant</p>
              <Badge className="border-emerald-300/30 bg-emerald-400/10 text-emerald-200">
                Live
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-white/65">
              {assistantLabel} · {context.clientName}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!standalone ? (
            <>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex size-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                title="Minimize phone assistant"
              >
                <Minimize2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setDismissedCallId(context.call?.id ?? null)}
                className="flex size-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                title="Hide for this call"
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => window.northstarDesktop?.minimize()}
              className="flex size-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
              title="Minimize"
            >
              <Minimize2 className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="max-h-[calc(100vh-7.25rem)] space-y-4 overflow-y-auto p-4">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">
                {interaction?.contactName ?? "Unknown caller"}
              </p>
              <p className="text-xs text-muted-foreground">
                {interaction?.contactPhone ?? "Phone unavailable"}
              </p>
            </div>
            <Badge variant="outline">{matchLabel}</Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
            <Field label="Email" value={interaction?.contactEmail} />
            <Field label="Address" value={interaction?.contactAddress} />
            <Field
              label="Urgency"
              value={context.analysis?.urgency ?? context.routing?.urgency}
            />
            <Field
              label="Intent"
              value={
                context.routing?.category ??
                (context.slots.length > 0 ? "Scheduling" : null)
              }
            />
          </div>
        </section>

        {context.analysis ? (
          <section>
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              <p className="text-xs font-semibold">What to do next</p>
            </div>
            <p className="mt-1.5 text-sm leading-5">
              {context.analysis.recommendedNextAction}
            </p>
            {context.analysis.missingFields.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {context.analysis.missingFields.map((field) => (
                  <Badge key={field} variant="outline">
                    Ask: {field}
                  </Badge>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {context.slots.length > 0 ? (
          <section className="border-y py-3">
            <div className="flex items-center gap-2">
              <CalendarClock
                className="size-3.5 text-primary"
                aria-hidden="true"
              />
              <p className="text-xs font-semibold">Best available times</p>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {context.slots.slice(0, 3).map((slot, index) => (
                <div
                  key={slot.startIso}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs font-medium",
                    index === 0
                      ? "border-primary/40 bg-primary/5"
                      : "bg-background",
                  )}
                >
                  {slot.label}
                  {index === 0 ? (
                    <span className="mt-0.5 block text-[10px] text-primary">
                      Best match
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {context.slotsNote}
            </p>
          </section>
        ) : null}

        <section>
          <p className="text-xs font-semibold">Live transcript</p>
          <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {transcript.length > 0 ? (
              transcript.map((turn, index) => (
                <div
                  key={`${turn.at}-${index}`}
                  className={cn(
                    "flex gap-2 text-xs",
                    turn.role === "caller" ? "" : "justify-end",
                  )}
                >
                  {turn.role === "caller" ? (
                    <UserRound className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                  <p
                    className={cn(
                      "max-w-[88%] rounded-md px-2.5 py-2 leading-5",
                      turn.role === "caller"
                        ? "bg-secondary"
                        : "border bg-background",
                    )}
                  >
                    {turn.content}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Listening for the first turn…
              </p>
            )}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-[11px] text-muted-foreground">
            {context.crm.providerLabel === "Northstar CRM"
              ? `Saving to ${productName}`
              : `Will sync to ${context.crm.providerLabel} after the call`}
          </p>
          <div className="flex items-center gap-2">
            {context.booking?.status === "pending" ? (
              <Button asChild size="sm">
                <Link href={`${context.basePath}/approvals`}>
                  Review booking
                  <ExternalLink className="size-3.5" />
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={`${context.basePath}/assistant`}>
                Open assistant
                <Maximize2 className="size-3.5" />
              </Link>
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );

  return standalone ? overlay : createPortal(overlay, document.body);
}
