"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  PhoneCall,
  PhoneOff,
  Send,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ToolUse = {
  name: string;
  result: Record<string, unknown>;
};

type Turn = {
  role: "assistant" | "caller";
  text: string;
};

type ApiResult = {
  error?: string;
  call_session_id?: string;
  greeting?: string | null;
  reply?: string | null;
  tools_used?: ToolUse[];
  end_call?: boolean;
  runtime?: "openai" | "scripted";
  report?: Record<string, unknown>;
};

export function VoiceCallLab({
  clientId,
  canOperate,
}: {
  clientId: string;
  canOperate: boolean;
}) {
  const router = useRouter();
  const [fromNumber, setFromNumber] = useState("+15550101234");
  const [callerText, setCallerText] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<"openai" | "scripted" | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tools, setTools] = useState<ToolUse[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggestedSlots = useMemo(
    () =>
      tools.flatMap((tool) => {
        if (tool.name !== "propose_slots" || !Array.isArray(tool.result.slots)) {
          return [];
        }

        return (tool.result.slots as { label?: string; start_iso?: string }[])
          .filter((slot) => slot.label && slot.start_iso)
          .map((slot) => ({
            label: slot.label as string,
            startIso: slot.start_iso as string,
          }));
      }),
    [tools],
  );

  async function post(body: Record<string, unknown>): Promise<ApiResult> {
    const response = await fetch("/api/voice/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as ApiResult;
  }

  async function startCall() {
    if (!canOperate) return;
    setBusy(true);
    setMessage(null);
    setReport(null);
    setTurns([]);
    setTools([]);

    try {
      const data = await post({
        action: "start",
        client_id: clientId,
        from_number: fromNumber,
      });

      if (data.error || !data.call_session_id) {
        setMessage(data.error ?? "The call could not be started.");
        return;
      }

      setCallId(data.call_session_id);
      setRuntime(data.runtime ?? "scripted");
      setTools(data.tools_used ?? []);
      if (data.greeting) {
        setTurns([{ role: "assistant", text: data.greeting }]);
      }
    } catch {
      setMessage("The call test could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTurn() {
    const text = callerText.trim();
    if (!callId || !text || busy) return;

    setCallerText("");
    setTurns((current) => [...current, { role: "caller", text }]);
    setBusy(true);
    setMessage(null);

    try {
      const data = await post({
        action: "caller_turn",
        call_session_id: callId,
        text,
      });

      if (data.error) {
        setMessage(data.error);
        return;
      }

      setRuntime(data.runtime ?? runtime);
      setTools((current) => [...current, ...(data.tools_used ?? [])]);
      if (data.reply) {
        setTurns((current) => [
          ...current,
          { role: "assistant", text: data.reply as string },
        ]);
      }
      if (data.end_call) {
        setMessage("The assistant is ready to complete the call.");
      }
    } catch {
      setMessage("The assistant turn failed.");
    } finally {
      setBusy(false);
    }
  }

  async function completeCall() {
    if (!callId || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const data = await post({
        action: "complete",
        call_session_id: callId,
      });

      if (data.error) {
        setMessage(data.error);
        return;
      }

      setReport(data.report ?? {});
      setCallId(null);
      setMessage(
        "Call completed. The transcript, summary, CRM note, workflows, and approvals were processed.",
      );
      router.refresh();
    } catch {
      setMessage("The call could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-sidebar px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <PhoneCall className="size-4 text-brand-gold" aria-hidden="true" />
            <span className="text-sm font-semibold">AI call assistant</span>
          </div>
          <Badge
            variant="outline"
            className="border-white/20 bg-white/10 text-white"
          >
            {callId
              ? runtime === "openai"
                ? "Live AI sandbox"
                : "Scripted sandbox"
              : "Ready"}
          </Badge>
        </div>

        {!callId && turns.length === 0 ? (
          <div className="grid min-h-96 place-items-center px-6 py-10 text-center">
            <div>
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <PhoneCall className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold">Start a customer call</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                The assistant listens to each turn, captures customer details,
                checks availability, proposes matching times, and sends
                bookings or follow-ups to approval.
              </p>
              <div className="mx-auto mt-5 flex max-w-sm gap-2">
                <Input
                  value={fromNumber}
                  onChange={(event) => setFromNumber(event.target.value)}
                  aria-label="Caller phone number"
                  placeholder="Caller phone"
                  disabled={!canOperate || busy}
                />
                <Button
                  type="button"
                  onClick={startCall}
                  disabled={!canOperate || busy}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <PhoneCall aria-hidden="true" />
                  )}
                  Start
                </Button>
              </div>
              {!canOperate ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  This support view is read-only.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="h-96 space-y-3 overflow-y-auto bg-secondary/20 px-4 py-4">
              {turns.map((turn, index) => (
                <div
                  key={`${turn.role}-${index}`}
                  className={`flex gap-2 ${
                    turn.role === "caller" ? "justify-end" : "justify-start"
                  }`}
                >
                  {turn.role === "assistant" ? (
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Bot className="size-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                  <p
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-5 ${
                      turn.role === "caller"
                        ? "bg-primary text-primary-foreground"
                        : "border bg-card"
                    }`}
                  >
                    {turn.text}
                  </p>
                  {turn.role === "caller" ? (
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <UserRound className="size-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                </div>
              ))}
              {busy ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Assistant is listening…
                </div>
              ) : null}
            </div>

            {callId ? (
              <div className="border-t p-3">
                <div className="flex gap-2">
                  <Input
                    value={callerText}
                    onChange={(event) => setCallerText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void sendTurn();
                    }}
                    placeholder='Customer says: "Friday morning works best…"'
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    size="icon"
                    onClick={sendTurn}
                    disabled={busy || !callerText.trim()}
                    title="Send caller turn"
                  >
                    <Send aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    onClick={completeCall}
                    disabled={busy}
                    title="Complete call"
                  >
                    <PhoneOff aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}

        {message ? (
          <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
            {message}
          </p>
        ) : null}
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border bg-card p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Scheduling popup
          </p>
          {suggestedSlots.length > 0 ? (
            <div className="mt-3 space-y-2">
              {suggestedSlots.slice(-3).map((slot, index) => (
                <div
                  key={`${slot.startIso}-${index}`}
                  className="flex items-start gap-2 rounded-md border bg-background p-2.5"
                >
                  <CalendarClock
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">{slot.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Available for this customer
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Matching slots appear here when the customer mentions a preferred
              day or time.
            </p>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Tools used
          </p>
          {tools.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {tools.slice(-8).map((tool, index) => (
                <li
                  key={`${tool.name}-${index}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                  {tool.name.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Contact lookup, CRM notes, slot proposals, booking requests, and
              escalation appear as they run.
            </p>
          )}
        </section>

        {report ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Post-call pipeline completed
            </p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              Summary, CRM note, transcript, routing, and approval records were
              produced.
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

