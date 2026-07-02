"use client";

import { useActionState } from "react";
import { KeyRound, Mail } from "lucide-react";

import { requestLoginLink } from "@/app/login/actions";
import { initialLoginActionState } from "@/app/login/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginFormProps = {
  isSupabaseConfigured: boolean;
  nextPath: string;
};

export function LoginForm({
  isSupabaseConfigured,
  nextPath,
}: LoginFormProps) {
  const [state, formAction, pending] = useActionState(
    requestLoginLink,
    initialLoginActionState,
  );
  const isDisabled = !isSupabaseConfigured || pending;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={nextPath} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="partner@example.com"
            disabled={isDisabled}
            className="pl-9"
            required
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isDisabled}>
        <KeyRound aria-hidden="true" />
        {pending ? "Sending..." : "Send sign-in link"}
      </Button>

      {!isSupabaseConfigured ? (
        <p className="rounded-md border border-accent/35 bg-accent/10 px-3 py-2 text-sm text-foreground">
          Authentication is not configured for this environment yet.
        </p>
      ) : null}

      {state.message ? (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          data-status={state.status}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
