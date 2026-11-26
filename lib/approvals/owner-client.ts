import { z } from "zod";
import { OWNER_APPROVAL_BODY_BYTES, OWNER_APPROVAL_RESPONSE_BYTES, OwnerApprovalResultSchema, ownerApprovalFormCommand, type OwnerApprovalResult } from "./owner-command.ts";

const uncertain = (): OwnerApprovalResult => ({ status: "error", httpStatus: 503,
  message: "The decision could not be confirmed. Refresh approvals and check Action history before deciding again." });

async function boundedReceipt(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > OWNER_APPROVAL_RESPONSE_BYTES || !response.body) throw new Error();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > OWNER_APPROVAL_RESPONSE_BYTES) { try { await reader.cancel(); } catch { /* Receipt remains unconfirmed. */ } throw new Error(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}

/** One explicit owner decision, one request. A lost receipt never resends it. */
export async function submitOwnerApproval(approvalId: string, form: FormData, request: typeof fetch = fetch): Promise<OwnerApprovalResult> {
  let body: string;
  try {
    z.uuid().parse(approvalId);
    body = JSON.stringify(ownerApprovalFormCommand(form));
    if (new TextEncoder().encode(body).byteLength > OWNER_APPROVAL_BODY_BYTES) throw new Error();
  } catch {
    return { status: "error", httpStatus: 400, message: "Check the decision, edited content and note before submitting." };
  }
  try {
    const response = await request(`/api/business/approvals/${approvalId}`, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(30000),
    });
    const parsed = OwnerApprovalResultSchema.safeParse(await boundedReceipt(response));
    if (!parsed.success || parsed.data.httpStatus !== response.status) return uncertain();
    return parsed.data;
  } catch { return uncertain(); }
}
