"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";

// Public website chat widget. Self-contained: talks only to the public
// widget API with its widget key; no app session, no tenant data beyond
// the business name and the assistant's replies.

type Turn = { role: "visitor" | "assistant"; content: string };

export function ChatWidget({
  widgetKey,
  clientName,
}: {
  widgetKey: string;
  clientName: string;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [waiting, setWaiting] = useState("");
  const greeting = useRef("");
  const pendingMessage = useRef<{ text: string; id: string } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(`business-chat:${widgetKey}`) ?? "null",
          ) as { id?: string; greeting?: string; savedAt?: number } | null;
          if (
            saved?.id &&
            /^[0-9a-f-]{36}$/i.test(saved.id) &&
            saved.greeting &&
            Date.now() - (saved.savedAt ?? 0) < 7 * 86400000
          ) {
            greeting.current = saved.greeting;
            setSessionId(saved.id);
            setTurns([{ role: "assistant", content: saved.greeting }]);
            setShared(true);
            return;
          }
        } catch {
          /* Storage may be blocked by the embedding browser. */
        }
        const response = await fetch(`/api/widget/${widgetKey}/session`, {
          method: "POST",
        });
        const body = (await response.json()) as {
          session_id?: string;
          greeting?: string;
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok || !body.session_id) {
          setError(body.error ?? "Chat is unavailable right now.");
          return;
        }

        greeting.current = body.greeting ?? "How can we help?";
        setSessionId(body.session_id);
        setTurns([
          { role: "assistant", content: body.greeting ?? "How can we help?" },
        ]);
      } catch {
        if (!cancelled) {
          setError("Chat is unavailable right now.");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [widgetKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  useEffect(() => {
    if (!sessionId || !shared || done) return;
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/widget/${widgetKey}/updates?session_id=${sessionId}`,
          { cache: "no-store" },
        );
        if (!response.ok || stopped) return;
        const data = await response.json();
        if (stopped) return;
        setTurns([
          { role: "assistant", content: greeting.current },
          ...data.messages.map((m: { direction: string; body: string }) => ({
            role: m.direction === "inbound" ? "visitor" : "assistant",
            content: m.body,
          })),
        ]);
        if (data.messages.at(-1)?.direction === "outbound") setWaiting("");
        setDone(data.complete);
      } catch {
        /* Keep the saved conversation visible during temporary outages. */
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, shared, done, widgetKey]);

  const send = async () => {
    const message = input.trim();

    if (!message || !sessionId || busy || done) {
      return;
    }

    if (pendingMessage.current?.text !== message)
      pendingMessage.current = { text: message, id: crypto.randomUUID() };
    setInput("");
    setTurns((previous) => [
      ...previous,
      { role: "visitor", content: message },
    ]);
    setBusy(true);

    try {
      const response = await fetch(`/api/widget/${widgetKey}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          message_id: pendingMessage.current.id,
        }),
      });
      const body = (await response.json()) as {
        queued?: boolean;
        reply?: string;
        complete?: boolean;
        error?: string;
      };

      if (!response.ok || !body.reply) {
        setInput(message);
        setTurns((previous) => [
          ...previous,
          {
            role: "assistant",
            content:
              body.error ??
              "Sorry — something went wrong. Please try again in a moment.",
          },
        ]);
        return;
      }

      pendingMessage.current = null;
      if (body.queued) {
        try {
          sessionStorage.setItem(
            `business-chat:${widgetKey}`,
            JSON.stringify({
              id: sessionId,
              greeting: greeting.current,
              savedAt: Date.now(),
            }),
          );
        } catch {
          /* Chat still works when browser storage is unavailable. */
        }
        setShared(true);
        setWaiting(body.reply ?? "Message saved.");
      } else
        setTurns((previous) => [
          ...previous,
          { role: "assistant", content: body.reply as string },
        ]);

      if (body.complete) {
        setDone(true);
      }
    } catch {
      setInput(message);
      setTurns((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            "Sorry — something went wrong. Please try again in a moment.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {turns.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === "assistant"
                ? "max-w-[85%] rounded-lg rounded-bl-sm border bg-card px-3 py-2 text-sm leading-5"
                : "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm leading-5 text-primary-foreground"
            }
          >
            {turn.content}
          </div>
        ))}
        {waiting && (
          <p role="status" className="text-xs text-muted-foreground">
            {waiting}
          </p>
        )}
        {busy ? (
          <div className="max-w-[85%] rounded-lg rounded-bl-sm border bg-card px-3 py-2 text-sm text-muted-foreground">
            …
          </div>
        ) : null}
        {done ? (
          <p className="pt-1 text-center text-xs text-muted-foreground">
            Conversation sent to {clientName}. You can close this window.
          </p>
        ) : null}
      </div>

      <form
        className="flex items-center gap-2 border-t bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={done ? "Conversation complete" : "Type your message…"}
          aria-label="Your message"
          maxLength={2000}
          disabled={!sessionId || busy || done}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!sessionId || busy || done || !input.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
          aria-label="Send message"
        >
          <SendHorizonal className="size-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
