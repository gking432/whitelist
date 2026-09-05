"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { sessionTokensFromHash } from "@/lib/auth/browser-session";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ConfirmSession({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function confirm() {
      const tokens = sessionTokensFromHash(window.location.hash);
      const code = new URLSearchParams(window.location.search).get("code");

      window.history.replaceState(null, "", `/auth/confirm?next=${encodeURIComponent(nextPath)}`);

      const supabase = createSupabaseBrowserClient();
      const result = tokens
        ? await supabase.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          })
        : code
          ? await supabase.auth.exchangeCodeForSession(code)
          : { error: new Error("This secure link is incomplete or expired.") };

      if (!active) return;

      if (result.error) {
        setError(result.error.message);
        return;
      }

      window.location.replace(nextPath);
    }

    void confirm();
    return () => {
      active = false;
    };
  }, [nextPath]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-md border bg-card p-6 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          {error ? (
            <ShieldCheck className="size-5" aria-hidden="true" />
          ) : (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          )}
        </span>
        <h1 className="mt-4 text-lg font-semibold">
          {error ? "Secure link unavailable" : "Finishing secure sign in"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error ?? "Your workspace is opening now."}
        </p>
        {error ? (
          <a className="mt-5 inline-flex text-sm font-medium text-primary hover:underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
            Request a new sign-in link
          </a>
        ) : null}
      </section>
    </main>
  );
}
