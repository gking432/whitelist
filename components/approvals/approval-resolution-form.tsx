"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { initialFormState, type FormState } from "@/lib/forms/state";

type ApprovalResolutionFormProps = {
  action: (previousState: FormState, formData: FormData) => Promise<FormState>;
  editableContent: string | null;
  consequence: string;
};

export function ApprovalResolutionForm({
  action,
  editableContent,
  consequence,
}: ApprovalResolutionFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      {editableContent !== null ? (
        <div>
          <Label htmlFor="edited_content">Message content</Label>
          <Textarea
            id="edited_content"
            name="edited_content"
            className="mt-1.5"
            defaultValue={editableContent}
            rows={4}
          />
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Use “Edit &amp; approve” to approve your edited version above.
          </p>
        </div>
      ) : null}

      <div>
        <Label htmlFor="note">Resolution note (optional)</Label>
        <Input
          id="note"
          name="note"
          className="mt-1.5"
          placeholder="Reason or context for this decision"
        />
      </div>

      <p className="rounded-md border bg-secondary/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {consequence}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="resolution"
          value="approve"
          disabled={isPending}
        >
          Approve
        </Button>
        {editableContent !== null ? (
          <Button
            type="submit"
            name="resolution"
            value="edit_and_approve"
            variant="secondary"
            disabled={isPending}
          >
            Edit &amp; approve
          </Button>
        ) : null}
        <Button
          type="submit"
          name="resolution"
          value="reject"
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/5"
          disabled={isPending}
        >
          Reject
        </Button>
      </div>
    </form>
  );
}
