import Link from "next/link";

export function OnboardingProgress({ current }: { current: "profile" | "apps" | "context" | "activation" }) {
  return (
    <nav aria-label="Business setup" className="flex flex-wrap gap-x-6 gap-y-3 text-xs leading-6 text-muted-foreground">
      {[
        { key: "profile", href: "/client/business/business", label: "1. Business details" },
        { key: "apps", href: "/client/apps", label: "2. Connect apps" },
        { key: "context", href: "/client/onboarding", label: "3. Review facts & authority" },
        { key: "activation", href: "/client/activate", label: "4. Work & readiness" },
      ].map((step) => (
        <Link key={step.key} href={step.href} aria-current={step.key === current ? "step" : undefined} className={step.key === current ? "font-medium text-foreground" : "hover:text-foreground underline-offset-4 hover:underline"}>
          {step.label}
        </Link>
      ))}
    </nav>
  );
}
