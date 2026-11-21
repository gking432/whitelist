import type { CanonicalRecord } from "../connectors/types.ts";
import { allowsActivatedGoogleInbox } from "../connectors/read-only-policy.ts";

type MimePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: MimePart[];
};
export function gmailPlainText(part: MimePart | undefined, depth = 0): string {
  if (!part || depth > 12 || part.filename) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, 6000);
  return (part.parts ?? [])
    .slice(0, 30)
    .map((child) => gmailPlainText(child, depth + 1))
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}
export function emailAddress(value: unknown): string | null {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
  const match = value
    .trim()
    .match(/^(?:[^<>]*<)?([^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+)>?$/);
  return match ? match[1].toLowerCase() : null;
}
export function automatedMail(
  headers: Record<string, string>,
  sender: string | null,
) {
  return (
    !!headers["list-unsubscribe"] ||
    !!headers["list-id"] ||
    /bulk|list|junk/i.test(headers.precedence ?? "") ||
    (!!headers["auto-submitted"] &&
      headers["auto-submitted"].toLowerCase() !== "no") ||
    /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)@/i.test(
      sender ?? "",
    )
  );
}
/** Never convert history, sent mail, mailing lists or message snippets into new inquiries. */
export function shouldFetchInboxBody(
  receivedAt: unknown,
  config: Record<string, unknown>,
) {
  const received =
    typeof receivedAt === "string" ? Date.parse(receivedAt) : NaN;
  const enabled =
    typeof config.conversation_intake_enabled_at === "string"
      ? Date.parse(config.conversation_intake_enabled_at)
      : NaN;
  return (
    config.conversation_intake_enabled === true &&
    Number.isFinite(received) &&
    Number.isFinite(enabled) &&
    received >= enabled &&
    received <= Date.now() + 60_000
  );
}
export function inboxInquiry(
  record: CanonicalRecord,
  config: Record<string, unknown>,
  runtimeMode: string,
  now = Date.now(),
  providerKey = "",
) {
  const enabledAt =
    typeof config.conversation_intake_enabled_at === "string"
      ? Date.parse(config.conversation_intake_enabled_at)
      : NaN;
  const receivedAt = record.updatedAt ? Date.parse(record.updatedAt) : NaN;
  if (
    record.objectType !== "message" ||
    (config.workspace_view_only === true && !allowsActivatedGoogleInbox(config, runtimeMode, providerKey, now)) ||
    record.deleted ||
    config.conversation_intake_enabled !== true ||
    runtimeMode !== "live" ||
    !Number.isFinite(enabledAt) ||
    !Number.isFinite(receivedAt) ||
    receivedAt < enabledAt ||
    receivedAt > now + 60_000 ||
    record.data.inbound !== true ||
    record.data.automated !== false ||
    record.data.has_attachments === true
  )
    return null;
  const sender = emailAddress(record.data.sender);
  if (sender === emailAddress(config.activation_account_email)) return null;
  const body = record.data.body;
  if (!sender || typeof body !== "string" || !body.trim() || !record.externalId)
    return null;
  return {
    sender,
    message: body.trim().slice(0, 6000),
    occurred_at: new Date(receivedAt).toISOString(),
    subject: record.data.subject ?? null,
  };
}
