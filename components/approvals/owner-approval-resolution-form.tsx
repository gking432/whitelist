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
  onSaved?: () => void;
}) {
  const router = useRouter();
  async function decide(_previous: FormState, data: FormData): Promise<FormState> {
    const result = await submitOwnerApproval(approvalId, data);
    if (result.status === "success") { router.refresh(); onSaved?.(); }
    return result;
  }
  return <div data-owner-approval-id={approvalId}><ApprovalResolutionForm {...form} action={decide} /></div>;
}
