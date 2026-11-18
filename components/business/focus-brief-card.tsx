import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { FocusBrief } from "@/lib/business/focus-brief";

export function FocusBriefCard({
  brief,
  greeting,
}: {
  brief: FocusBrief;
  greeting: string;
}) {
  return (
    <section
      aria-label="Your daily brief"
      className="rounded-2xl border border-[#d7e5ff] bg-[#edf3ff] px-5 py-6 text-left text-[#183766] sm:px-6"
    >
      <h1 className="break-words text-[26px] font-medium leading-tight tracking-[-0.03em] sm:text-[30px]">
        {greeting}
      </h1>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="min-w-0 max-w-2xl text-sm leading-6 text-[#516c94]">
          <span className="font-medium text-[#244c86]">{brief.title}</span>{" "}
          {brief.description}
        </p>
        {brief.link ? (
          <Link
            href={brief.link.href}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-[#244c86] hover:underline"
          >
            {brief.link.label}
            <ArrowUpRight className="size-3" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
