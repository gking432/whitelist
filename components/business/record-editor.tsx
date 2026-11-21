"use client";
import { useEffect, useId, useRef } from "react";
import { X, ArrowRight } from "lucide-react";
import type {
  BusinessRecord,
  RecordData,
  RecordKind,
} from "@/lib/business/types";
import { KIND_LABELS, RECORD_FIELDS } from "./record-fields";
export const inputClass =
  "w-full rounded-xl border border-input bg-background/40 px-3.5 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50";
export const buttonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-secondary disabled:opacity-50";
export function BusinessDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/35"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-6 py-4">
        <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">
          {title}
        </h2>
        <button
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-secondary"
          aria-label="Close dialog"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="p-6">{children}</div>
    </dialog>
  );
}
export function RecordEditor({
  kind,
  record,
  initialData,
  records,
  busy,
  error,
  onSave,
  onClose,
}: {
  kind: RecordKind;
  record?: BusinessRecord;
  initialData?: RecordData;
  records: BusinessRecord[];
  busy: boolean;
  error?: string;
  onSave: (record: unknown, id?: string, revision?: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const values = record?.data ?? initialData;
  const formId = useId();
  const label =
    kind === "knowledge" && values?.category === "Industry update"
      ? "industry update"
      : KIND_LABELS[kind].toLowerCase();
  return (
    <BusinessDialog
      title={`${record ? "Edit" : "New"} ${label}`}
      onClose={onClose}
    >
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const data: Record<string, string | number> = {};
          for (const field of RECORD_FIELDS[kind])
            data[field.key] =
              field.type === "number"
                ? Number(form.get(field.key) || 0)
                : String(form.get(field.key) || "");
          if (
            await onSave(
              { kind, title: form.get("title"), body: form.get("body"), data },
              record?.id,
              record?.revision,
            )
          )
            onClose();
        }}
      >
        <label className="block space-y-2 text-sm font-medium">
          Title
          <input
            name="title"
            required
            minLength={2}
            maxLength={180}
            defaultValue={record?.title}
            className={inputClass}
            placeholder={
              kind === "job"
                ? "What needs to get done?"
                : `Name this ${KIND_LABELS[kind].toLowerCase()}`
            }
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {RECORD_FIELDS[kind].map((field) => (
            <div
              key={field.key}
              className={`block space-y-2 text-sm font-medium ${field.type === "textarea" ? "sm:col-span-2" : ""}`}
            >
              <label htmlFor={`${formId}-${field.key}`}>{field.label}</label>
              {field.key === "product_id" || field.key === "goal_id" ? (
                <select
                  id={`${formId}-${field.key}`}
                  aria-describedby={
                    field.hint ? `${formId}-${field.key}-hint` : undefined
                  }
                  name={field.key}
                  defaultValue={String(values?.[field.key] ?? "")}
                  className={inputClass}
                >
                  <option value="">
                    {field.key === "goal_id"
                      ? "No linked goal"
                      : "No linked inventory item"}
                  </option>
                  {records
                    .filter(
                      (r) =>
                        r.kind ===
                          (field.key === "goal_id" ? "goal" : "product") &&
                        r.status !== "archived",
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                </select>
              ) : field.type === "select" ? (
                <select
                  id={`${formId}-${field.key}`}
                  aria-describedby={
                    field.hint ? `${formId}-${field.key}-hint` : undefined
                  }
                  name={field.key}
                  defaultValue={String(
                    values?.[field.key] ?? field.options?.[0] ?? "",
                  )}
                  className={inputClass}
                >
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  id={`${formId}-${field.key}`}
                  aria-describedby={
                    field.hint ? `${formId}-${field.key}-hint` : undefined
                  }
                  name={field.key}
                  defaultValue={String(values?.[field.key] ?? "")}
                  className={inputClass}
                  rows={4}
                />
              ) : (
                <input
                  id={`${formId}-${field.key}`}
                  aria-describedby={
                    field.hint ? `${formId}-${field.key}-hint` : undefined
                  }
                  name={field.key}
                  type={field.type ?? "text"}
                  min={
                    field.type === "number"
                      ? field.key === "target"
                        ? 0.01
                        : 0
                      : undefined
                  }
                  step={
                    field.type === "number"
                      ? [
                          "quantity",
                          "reorder_point",
                          "target_stock",
                          "lead_days",
                        ].includes(field.key)
                        ? "1"
                        : "0.01"
                      : undefined
                  }
                  defaultValue={String(
                    values?.[field.key] ?? field.default ?? "",
                  )}
                  className={inputClass}
                />
              )}
              {field.hint ? (
                <span
                  id={`${formId}-${field.key}-hint`}
                  className="block text-xs font-normal leading-5 text-muted-foreground"
                >
                  {field.hint}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <label className="block space-y-2 text-sm font-medium">
          {kind === "campaign"
            ? "Content / copy"
            : kind === "knowledge"
              ? "Content"
              : "Details & notes"}
          <textarea
            name="body"
            rows={6}
            maxLength={20000}
            defaultValue={record?.body}
            className={inputClass}
            placeholder="Add the facts, context, or instructions someone needs."
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={onClose} className={secondaryClass}>
            Cancel
          </button>
          <button disabled={busy} className={buttonClass}>
            {busy ? "Saving…" : "Save record"}
            <ArrowRight className="size-4" />
          </button>
        </div>
      </form>
    </BusinessDialog>
  );
}
