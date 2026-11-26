"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  Conversation,
  ConversationSnapshot,
} from "@/lib/conversations/types";
import {
  CHANNEL_NAMES,
  MESSAGE_FILTERS,
  matchesMessageFilter,
  type MessageFilter,
} from "@/lib/conversations/inbox-view";
import { validTimeZone } from "@/lib/business/daily-brief";
import { CustomerJourneyDisclosure } from "@/components/business/customer-journey";
import {
  OwnerAreaHeader,
  ownerButton,
  ownerInput,
  ownerQuietButton,
} from "@/components/business/owner-ui";

export function ConversationInbox({
  initialSnapshot,
  timeZone,
  preview = false,
}: {
  initialSnapshot: ConversationSnapshot;
  timeZone: string;
  preview?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [channel, setChannel] = useState<"all" | Conversation["channel"]>(
    "all",
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reply, setReply] = useState("");
  const generation = useRef(0),
    inFlight = useRef(false);
  const zone = validTimeZone(timeZone);
  const contacts = new Map(
    snapshot.contacts.map((contact) => [contact.id, contact]),
  );
  const contactName = (conversation: Conversation) => {
    const contact = contacts.get(conversation.contact_id);
    return (
      [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
      contact?.email ||
      contact?.phone ||
      "Customer"
    );
  };
  const conversations = snapshot.conversations.filter(
    (conversation) =>
      matchesMessageFilter(conversation, filter) &&
      (channel === "all" || conversation.channel === channel) &&
      (!search.trim() ||
        `${contactName(conversation)} ${conversation.summary} ${conversation.next_action}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())),
  );
  // Filtering must never display one thread's history beneath another customer.
  const selected = conversations.find(
    (conversation) => conversation.id === snapshot.selectedId,
  );
  const selectedMessages = selected
    ? snapshot.messages.filter((message) => message.conversation_id === selected.id)
    : [];
  const disabled = busy || !snapshot.canWrite;

  async function refresh(id: string | null = snapshot.selectedId) {
    if (preview) return;
    const version = ++generation.current;
    try {
      const response = await fetch(
        `/api/conversations${id ? `?id=${encodeURIComponent(id)}` : ""}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Messages could not be refreshed.");
      if (version === generation.current && !inFlight.current) {
        setSnapshot(result);
        setError("");
      }
    } catch (cause) {
      if (version === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Messages could not be refreshed.",
        );
    }
  }
  useEffect(() => {
    if (preview) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current)
        void refresh(snapshot.selectedId);
    }, 15000);
    return () => clearInterval(timer);
    // Poll only the selected thread; generation checks protect mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.selectedId, preview]);

  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (preview) return;
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: selected.id,
          revision: selected.revision,
          ...extra,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "This conversation could not be updated.",
        );
      setSnapshot(result.snapshot);
      setNotice(result.message);
      if (action === "reply") setReply("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This conversation could not be updated.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <OwnerAreaHeader title="Messages">
        <button
          aria-label="Refresh messages"
          className={ownerQuietButton}
          disabled={busy || preview}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </OwnerAreaHeader>
      {error ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-6 text-xs text-slate-600">
          {notice}
        </p>
      ) : null}
      {!snapshot.conversations.length ? (
        <Link
          href={preview ? "/preview/apps" : "/client/activate"}
          className="mt-6 inline-block text-xs text-slate-500 hover:text-slate-800"
        >
          Connect a messaging app
        </Link>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-5" aria-label="Filter messages">
              {MESSAGE_FILTERS.map((item) => (
                <button
                  key={item.value}
                  aria-pressed={filter === item.value}
                  onClick={() => {
                    setFilter(item.value);
                    setReply("");
                  }}
                  className={`min-h-9 text-xs ${filter === item.value ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="sr-only" htmlFor="message-channel">
                Message channel
              </label>
              <select
                id="message-channel"
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value as typeof channel);
                  setReply("");
                }}
                className="max-w-36 rounded-lg bg-white py-2 text-xs text-slate-500"
              >
                <option value="all">All channels</option>
                {Object.entries(CHANNEL_NAMES)
                  .filter(([value]) =>
                    snapshot.conversations.some(
                      (conversation) => conversation.channel === value,
                    ),
                  )
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
              <label className="sr-only" htmlFor="message-search">
                Search messages
              </label>
              <input
                id="message-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="w-28 rounded-lg border-0 bg-slate-50 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
          </div>
          <div
            className={`mt-7 grid gap-8 ${selected ? "lg:grid-cols-[240px_minmax(0,1fr)]" : ""}`}
          >
            <aside
              aria-label="Customer conversations"
              className="divide-y divide-slate-100"
            >
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  disabled={busy}
                  aria-pressed={selected?.id === conversation.id}
                  onClick={() => {
                    setReply("");
                    setNotice("");
                    if (preview) setSnapshot((current) => ({ ...current, selectedId: conversation.id }));
                    else void refresh(conversation.id);
                  }}
                  className={`block w-full px-2 py-4 text-left ${selected?.id === conversation.id ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                >
                  <span className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>{CHANNEL_NAMES[conversation.channel]}</span>
                    <span>
                      {conversation.state === "waiting_approval"
                        ? "Approval"
                        : conversation.state === "needs_attention"
                          ? "Needs you"
                          : conversation.state === "closed"
                            ? "Done"
                            : conversation.mode === "human"
                              ? "You"
                              : "Agent"}
                    </span>
                  </span>
                  <span className="mt-2 block break-words text-sm text-slate-800">
                    {contactName(conversation)}
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {conversation.next_action}
                  </span>
                </button>
              ))}
            </aside>
            {selected ? (
              <section
                aria-label={`Conversation with ${contactName(selected)}`}
                className="min-w-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-sm font-medium text-slate-800">
                      {contactName(selected)}
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {CHANNEL_NAMES[selected.channel]} ·{" "}
                      {selected.agent_key === "sales_assistant"
                        ? "Inquiry"
                        : "Customer care"}{" "}
                      ·{" "}
                      {selected.state === "closed"
                        ? "Closed"
                        : selected.mode === "human"
                          ? "You’re handling this"
                          : "Agent handling"}
                    </p>
                  </div>
                  <details className="relative">
                    <summary className="cursor-pointer list-none px-2 py-1 text-xs text-slate-500">
                      Options
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 grid min-w-44 rounded-xl border border-slate-100 bg-white p-2 shadow-lg shadow-slate-900/5">
                      <button
                        className={ownerQuietButton}
                        disabled={disabled || selected.state === "closed"}
                        onClick={() =>
                          void mutate(
                            selected.mode === "human" ? "resume" : "takeover",
                          )
                        }
                      >
                        {selected.mode === "human"
                          ? "Return to agents"
                          : "Take over"}
                      </button>
                      <button
                        className={ownerQuietButton}
                        disabled={
                          disabled ||
                          selected.opted_out ||
                          selected.mode === "human" ||
                          selected.state === "closed"
                        }
                        onClick={() => void mutate("retry")}
                      >
                        Recheck with agent
                      </button>
                      <button
                        className={ownerQuietButton}
                        disabled={disabled || selected.state === "closed"}
                        onClick={() => void mutate("close")}
                      >
                        Mark done
                      </button>
                    </div>
                  </details>
                </div>
                {!preview ? <CustomerJourneyDisclosure key={selected.id} filter={{ conversationId: selected.id }} timeZone={timeZone} /> : null}
                {selected.opted_out ? (
                  <p role="status" className="mt-4 text-xs text-amber-800">
                    This customer opted out. Outgoing messages are blocked.
                  </p>
                ) : null}
                {!snapshot.enabled && selected.state !== "closed" ? (
                  <p className="mt-4 text-xs text-slate-500">
                    Automated conversations are disabled.{" "}
                    <Link href="/client/activate" className="underline">
                      Agent settings
                    </Link>
                  </p>
                ) : null}
                <ol
                  className="max-h-[55dvh] space-y-5 overflow-y-auto py-6"
                  aria-label="Message history"
                >
                  {selectedMessages.map((message) => (
                    <li
                      key={message.id}
                      className={`max-w-[95%] ${message.direction === "outbound" ? "ml-auto" : ""}`}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                        <span>
                          {message.direction === "inbound"
                            ? contactName(selected)
                            : "Business"}
                        </span>
                        <span>
                          {new Intl.DateTimeFormat("en-US", {
                            timeZone: zone,
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(message.created_at))}
                        </span>
                        {message.direction === "outbound" ? (
                          <span>{message.status}</span>
                        ) : null}
                      </div>
                      <p
                        className={`whitespace-pre-wrap break-words text-sm leading-7 ${message.direction === "outbound" ? "rounded-xl bg-slate-50 px-4 py-3" : "text-slate-700"}`}
                      >
                        {message.body}
                      </p>
                      {message.approval_id && message.status === "draft" ? (
                        <Link
                          href="/client/approvals"
                          className="mt-2 inline-block text-xs text-slate-600 underline"
                        >
                          Review reply
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {selected.state !== "closed" &&
                !selected.opted_out &&
                snapshot.canWrite ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate("reply", { body: reply });
                    }}
                    className="border-t border-slate-100 pt-4"
                  >
                    <label htmlFor="owner-reply" className="sr-only">
                      Write a reply
                    </label>
                    <textarea
                      id="owner-reply"
                      rows={3}
                      maxLength={5000}
                      required
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      disabled={disabled}
                      placeholder="Write a reply…"
                      className={ownerInput}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-500">
                        Replies are prepared for your approval.
                      </span>
                      <button
                        className={ownerButton}
                        disabled={disabled || !reply.trim()}
                      >
                        Prepare reply
                      </button>
                    </div>
                  </form>
                ) : null}
                <details className="mt-6">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    Customer context
                  </summary>
                  <div className="mt-3 space-y-4">
                    <p className="text-xs leading-6 text-slate-500">
                      {selected.identity_status === "owner_verified"
                        ? "This channel is linked to a verified customer."
                        : "Customer identity is unverified. Verify who controls this channel before linking shared customer history."}
                    </p>
                    {selected.summary ? (
                      <p className="text-sm leading-6 text-slate-600">
                        {selected.summary}
                      </p>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      Next: {selected.next_action}
                    </p>
                    {snapshot.canWrite ? (
                      <form
                        className="space-y-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void mutate("link", {
                            contactId: form.get("contact"),
                            reason: form.get("reason"),
                          });
                        }}
                      >
                        <label
                          className="block text-xs text-slate-500"
                          htmlFor="verified-customer"
                        >
                          Verified customer record
                        </label>
                        <select
                          id="verified-customer"
                          name="contact"
                          className={ownerInput}
                          required
                          defaultValue=""
                          disabled={disabled}
                        >
                          <option value="" disabled>
                            Select a customer you verified
                          </option>
                          {snapshot.contacts.map((contact) => (
                            <option key={contact.id} value={contact.id}>
                              {[
                                contact.first_name,
                                contact.last_name,
                                contact.email,
                                contact.phone,
                              ]
                                .filter(Boolean)
                                .join(" · ") || contact.id}
                            </option>
                          ))}
                        </select>
                        <label
                          className="block text-xs text-slate-500"
                          htmlFor="verification-reason"
                        >
                          How did you verify this person?
                        </label>
                        <input
                          id="verification-reason"
                          name="reason"
                          className={ownerInput}
                          required
                          minLength={8}
                          maxLength={1000}
                          disabled={disabled}
                        />
                        <button
                          className={ownerQuietButton}
                          disabled={disabled}
                        >
                          Verify and link
                        </button>
                      </form>
                    ) : null}
                    {snapshot.events.length ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-slate-500">
                          Activity
                        </summary>
                        <ul className="mt-3 space-y-2 text-xs text-slate-500">
                          {snapshot.events.map((event) => (
                            <li key={event.id}>{event.detail}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </details>
                <p className="mt-5 text-[10px] text-slate-500">
                  Latest 100 messages · {zone.replaceAll("_", " ")}
                </p>
              </section>
            ) : null}
          </div>
          {snapshot.hasMore ? (
            <p className="mt-6 text-[11px] text-slate-500">
              Showing recent conversations. Filters and search apply to the 100
              loaded threads.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
