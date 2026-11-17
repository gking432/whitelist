import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DailyWorkSection } from "@/lib/business/focus-brief";
import { safeSourceUrl } from "@/lib/business/daily-brief";

export function DailyWorkSections({
  sections,
  onOpenRecord,
}: {
  sections: DailyWorkSection[];
  onOpenRecord: (id: string) => void;
}) {
  if (!sections.length) return null;
  return (
    <div className="mt-9 grid items-start gap-x-12 gap-y-9 lg:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.key}
          aria-labelledby={`daily-${section.key}`}
          className="min-w-0"
        >
          <div className="flex items-center justify-between gap-4">
            <h2
              id={`daily-${section.key}`}
              className="text-[13px] font-medium text-slate-600"
            >
              {section.title}
            </h2>
            {section.href ? (
              <Link
                href={section.href}
                className="text-xs text-slate-400 hover:text-slate-700"
                aria-label={`View all ${section.title.toLowerCase()}`}
              >
                View all <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </div>
          <div className="mt-2 divide-y divide-slate-100">
            {section.rows.map((row) => {
              const content = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm text-slate-800">
                      {row.title}
                    </span>
                    {row.detail ? (
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-[35%] shrink-0 text-right text-xs leading-5 text-slate-500">
                    {row.label}
                  </span>
                  <ArrowUpRight className="mt-1 size-3 shrink-0 text-slate-300" />
                </>
              );
              const classes =
                "flex w-full items-start gap-3 py-3.5 text-left hover:opacity-70";
              return row.recordId ? (
                <button
                  key={row.key}
                  onClick={() => onOpenRecord(row.recordId!)}
                  className={classes}
                >
                  {content}
                </button>
              ) : safeSourceUrl(row.href) ? (
                <a key={row.key} href={safeSourceUrl(row.href)!} className={classes} target="_blank" rel="noopener noreferrer">{content}</a>
              ) : row.href?.startsWith("/client/") ? (
                <Link key={row.key} href={row.href} className={classes}>
                  {content}
                </Link>
              ) : (
                <div key={row.key} className={classes}>
                  {content}
                </div>
              );
            })}
          </div>
          {section.remaining ? (
            <p className="mt-1 text-xs text-slate-400">
              {section.remaining} more in this view
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
