import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/app/login/login-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthState } from "@/lib/auth/session";
import { toSafeNextPath } from "@/lib/auth/redirects";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export const metadata = {
  title: "Sign In",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = toSafeNextPath(params.next);
  const authState = await getAuthState();

  if (authState.user) {
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <Button asChild variant="ghost" className="mb-4 px-0">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <CardTitle>Sign in to Partner Portal</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Use the email connected to your partner, client, or platform
              membership.
            </p>
          </CardHeader>
          <CardContent>
            <LoginForm
              isSupabaseConfigured={authState.isSupabaseConfigured}
              nextPath={nextPath}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
