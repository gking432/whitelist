"use client";

import { useRouter } from "next/navigation";
import { ApprovalResolutionForm } from "@/components/approvals/approval-resolution-form";
import { submitOwnerApproval } from "@/lib/approvals/owner-client";
import type { FormState } from "@/lib/forms/state";

export function OwnerApprovalResolutionForm({ approvalId, onSaved, ...form }: {
  approvalId: string;
  editableContent: string | null;
  consequence: string;
  allowEdit?: boolean;
  inline?: boolean;
  approveLabel?: string;
  onSaved?: (message: string) => void;
}) {
  const router = useRouter();
  async function decide(_previous: FormState, data: FormData): Promise<FormState> {
    if (form.inline && form.allowEdit && form.editableContent !== null &&
        data.get("resolution") === "approve" && String(data.get("edited_content") ?? "").replace(/\r\n?/g, "\n") !== form.editableContent.replace(/\r\n?/g, "\n")) {
      data.set("resolution", "edit_and_approve");
    }
    const result = await submitOwnerApproval(approvalId, data);
    if (result.status === "success") { router.refresh(); onSaved?.(result.message || "Decision saved."); }
    return result;
  }
  return <div data-owner-approval-id={approvalId}><ApprovalResolutionForm {...form} action={decide} /></div>;
}
