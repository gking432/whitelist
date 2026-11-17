"use client";
import { useState } from "react";
import { Check, Copy, Pencil, ShoppingBag, ExternalLink } from "lucide-react";
import {
  allowedTransitions,
  displayMoney,
  opportunityEconomics,
} from "@/lib/business/rules";
import type { BusinessRecord } from "@/lib/business/types";
import {
  BusinessDialog,
  buttonClass,
  inputClass,
  secondaryClass,
} from "./record-editor";
import { KIND_LABELS, RECORD_FIELDS } from "./record-fields";
export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${status === "needs_approval" ? "bg-amber-50 text-amber-800" : ["approved", "completed", "received", "published", "paid"].includes(status) ? "bg-emerald-50 text-emerald-800" : status === "blocked" || status === "rejected" ? "bg-red-50 text-red-700" : "bg-secondary text-muted-foreground"}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function RecordDetail({
  record,
  currency,
  busy,
  canWrite,
  onClose,
  onEdit,
  onMutation,
}: {
  record: BusinessRecord;
  currency: string;
  busy: boolean;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onMutation: (input: unknown) => Promise<boolean>;
}) {
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const requiresReference = (action: string) =>
    ["order", "publish", "pay"].includes(action);
  const transitions = allowedTransitions(record.kind, record.status);
  const economy =
    record.kind === "opportunity" ? opportunityEconomics(record.data) : null;
  return (
    <BusinessDialog title={record.title} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            {KIND_LABELS[record.kind]} · Revision {record.revision}
          </span>
          <StatusPill status={record.status} />
        </div>
        {economy ? (
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-secondary/60 p-4">
            {[
              ["Landed cost", displayMoney(economy.landed, currency)],
              ["Expected contribution", displayMoney(economy.profit, currency)],
              [
                "Expected margin",
                economy.margin === null ? "—" : `${economy.margin}%`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {record.kind === "purchase" || record.kind === "quote" ? (
          <div className="rounded-xl bg-primary/5 p-4">
            <p className="text-xs text-muted-foreground">
              {record.kind === "purchase"
                ? "Expected total including recorded shipping"
                : "Quoted total"}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {displayMoney(
                Number(record.data.quantity || 0) *
                  Number(record.data.unit_cost ?? record.data.unit_price ?? 0) +
                  Number(record.data.shipping || 0),
                currency,
              )}
            </p>
          </div>
        ) : null}
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {RECORD_FIELDS[record.kind]
            .filter(
              (f) =>
                record.data[f.key] !== "" &&
                record.data[f.key] != null &&
                f.key !== "product_id" &&
                f.key !== "goal_id",
            )
            .map((field) => (
              <div key={field.key}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {field.type === "url" &&
                  typeof record.data[field.key] === "string" &&
                  /^https?:\/\//.test(String(record.data[field.key])) ? (
                    <a
                      href={String(record.data[field.key])}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      Open source
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    String(record.data[field.key])
                  )}
                </dd>
              </div>
            ))}
        </dl>
        {record.body ? (
          <section className="rounded-xl border bg-background/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {record.kind === "campaign" ? "Prepared content" : "Details"}
              </h3>
              <button
                className="inline-flex items-center gap-1 text-xs text-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(record.body);
                    setCopied(true);
                  } catch {
                    setMessage("Select the text to copy it manually.");
                  }
                }}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {record.body}
            </p>
          </section>
        ) : null}
        {record.data.completion_reference ? (
          <p className="break-words text-xs text-muted-foreground">
            Recorded confirmation: {String(record.data.completion_reference)}
          </p>
        ) : null}
        {canWrite && transitions.some((t) => requiresReference(t.action)) ? (
          <label className="block space-y-2 text-sm font-medium">
            Confirmation reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={2000}
              className={inputClass}
              placeholder={
                record.kind === "purchase"
                  ? "Supplier order number or acknowledgment"
                  : record.kind === "campaign"
                    ? "Published URL or campaign reference"
                    : "Payment reference"
              }
            />
            <span className="block text-xs font-normal leading-5 text-muted-foreground">
              Record this only after you have completed the action in the
              external system. This button does not send, purchase, or publish.
            </span>
          </label>
        ) : null}
        {record.kind === "purchase" && record.status === "ordered" ? (
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">
            Receive only after the full quantity has arrived. Linked inventory
            will increase by {String(record.data.quantity)} units. Partial
            receiving is not supported in this prototype.
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-primary">
            {message}
          </p>
        ) : null}
        {canWrite ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {["draft", "rejected"].includes(record.status) ? (
              <button
                onClick={onEdit}
                className={secondaryClass}
                disabled={busy}
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
            ) : null}
            {transitions.map((t) => (
              <button
                key={t.action}
                disabled={
                  busy ||
                  (requiresReference(t.action) && reference.trim().length < 3)
                }
                className={
                  t.action === "approve" || t.action === "submit"
                    ? buttonClass
                    : secondaryClass
                }
                onClick={async () => {
                  const ok = await onMutation({
                    action: "transition",
                    id: record.id,
                    revision: record.revision,
                    transition: t.action,
                    reference,
                  });
                  setMessage(
                    ok
                      ? "Saved."
                      : "The record changed or this action could not be saved. Refresh and review the current details.",
                  );
                }}
              >
                {t.label}
              </button>
            ))}
            {record.kind === "opportunity" && record.status !== "archived" ? (
              <button
                className={buttonClass}
                disabled={busy}
                onClick={async () => {
                  if (
                    await onMutation({
                      action: "purchase_opportunity",
                      id: record.id,
                      requestKey: crypto.randomUUID(),
                    })
                  ) {
                    setMessage(
                      "Purchase request prepared. Open Purchasing to review it.",
                    );
                  }
                }}
              >
                <ShoppingBag className="size-4" />
                Prepare purchase
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </BusinessDialog>
  );
}
