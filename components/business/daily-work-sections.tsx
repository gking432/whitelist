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
    <div className="mt-7 grid items-start gap-x-10 gap-y-7 xl:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.key}
          aria-labelledby={`daily-${section.key}`}
          data-work-section={section.key}
          className={`min-w-0 ${["attention", "money-source-review"].includes(section.key) ? "rounded-xl border border-slate-200 bg-white p-5 xl:col-span-2" : "rounded-xl border border-slate-200/80 bg-white p-5"}`}
        >
          <div className="flex items-center justify-between gap-4">
            <h2
              id={`daily-${section.key}`}
              className="text-sm font-semibold text-slate-700"
            >
              {section.title}
            </h2>
            {section.href ? (
              <Link
                href={section.href}
                className="inline-flex min-h-11 shrink-0 items-center text-xs text-slate-500 hover:text-slate-800"
                aria-label={`View all ${section.title.toLowerCase()}`}
              >
                View all <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </div>
          <div className="divide-y divide-slate-100">
            {section.rows.map((row) => {
              const content = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm text-slate-800">
                      {row.title}
                    </span>
                    {row.detail ? (
                      <span className="mt-1 block break-words text-xs leading-5 text-slate-500">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-[35%] shrink-0 break-words text-right text-xs leading-5 text-slate-500">
                    {row.label}
                  </span>
                  <ArrowUpRight className="mt-1 size-3 shrink-0 text-slate-300" />
                </>
              );
              const classes =
                "flex min-h-11 w-full items-start gap-3 rounded-md py-3.5 text-left hover:opacity-70";
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
          {section.links?.length ? <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-1">{section.links.map((link) => <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center text-xs font-medium text-blue-700 hover:underline">{link.label} <span className="ml-1" aria-hidden="true">↗</span></Link>)}</div> : null}
          {section.remaining ? (
            <p className="mt-2 text-xs text-slate-500">
              {section.remaining} more in this view
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
