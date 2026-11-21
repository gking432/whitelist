"use client";

import Link from "next/link";
import { Bot, CalendarDays, ChevronDown, House, Landmark, ListTodo, MessageSquare, PlugZap } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { OWNER_AREAS } from "@/lib/business/owner-navigation";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";
import { WorkspaceActivityTracker } from "./workspace-activity-tracker";

const navigationIcons = { Today: House, Messages: MessageSquare, "To-do": ListTodo, Calendar: CalendarDays, Money: Landmark, Manager: Bot, Apps: PlugZap };
const focusStyle = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
export function DailyBriefShell({ children, brandName, clientName, email, navigation, banner, accountActions, preview = false }: {
  children: React.ReactNode; brandName: string; clientName: string; email: string; navigation: WorkspaceNavItem[];
  banner?: React.ReactNode; accountActions?: React.ReactNode; preview?: boolean;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const home = preview ? "/preview" : "/client";
  const businessName = clientName.trim() || (preview ? "Business workspace" : "Your business");
  const mainPaths = new Set<string>(OWNER_AREAS.map((area) => preview ? area.href.replace("/client", "/preview") : area.href));
  // The caller has already filtered every item against this user's sections.
  const primary = OWNER_AREAS.flatMap((area) => { const item = navigation.find((candidate) => candidate.href === (preview ? area.href.replace("/client", "/preview") : area.href)); return item ? [item] : []; });
  const other = navigation.filter((item) => !mainPaths.has(item.href));
  const phoneItems = primary.filter((item) => ["Today", "Messages", "To-do", "Calendar"].includes(item.label));
  const moreItems = primary.filter((item) => !phoneItems.includes(item));
  const active = (item: WorkspaceNavItem) => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  const moreActive = [...moreItems, ...other].some(active);
  return <div className="min-h-dvh bg-[#f8fafc] text-slate-900">
    <a href="#workspace-content" className="ns-skip-link">Skip to content</a>
    {!preview ? <WorkspaceActivityTracker /> : null}
    {banner}
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 flex h-dvh flex-col px-4 py-6">
          <Link href={home} className={`min-h-11 rounded-lg px-3 py-2 ${focusStyle}`} title={businessName}>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">{preview ? "Preview" : "Your business"}</span>
            <span className="mt-1 block break-words text-lg font-semibold leading-6 tracking-tight text-slate-900">{businessName}</span>
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto">
          <nav aria-label="Business navigation" className="mt-7 space-y-1">
            {primary.map((item) => {
              const Icon = navigationIcons[item.label as keyof typeof navigationIcons] ?? House;
              return <Link key={item.href} href={item.href} aria-current={active(item) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active(item) ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"} ${focusStyle}`}><Icon aria-hidden="true" className="size-[18px] shrink-0" />{item.label}</Link>;
            })}
          </nav>
          {other.length ? <details className="mt-4 border-t border-slate-100 pt-3"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-50 ${focusStyle}`}>More tools<ChevronDown aria-hidden="true" className="size-4" /></summary><nav aria-label="More business tools" className="mt-1 max-h-[28dvh] space-y-1 overflow-y-auto">{other.map((item) => <Link key={item.href} href={item.href} aria-current={active(item) ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg px-3 text-sm ${active(item) ? "bg-blue-50 font-medium text-blue-800" : "text-slate-500 hover:bg-slate-50"} ${focusStyle}`}>{item.label}</Link>)}</nav></details> : null}
          </div>
          <div className="mt-auto border-t border-slate-100 px-3 pt-5">
            <p className="break-words text-[11px] leading-5 text-slate-400">{brandName}</p>
            {email ? <p className="mt-1 truncate text-xs text-slate-500" title={email}>{email}</p> : null}
            {accountActions ? <div className="mt-3 [&_button]:min-h-11 [&_button]:w-full [&_button]:text-left">{accountActions}</div> : null}
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur lg:hidden">
          <div className="flex items-start justify-between gap-4">
            <Link href={home} title={businessName} className={`min-h-11 min-w-0 rounded-md py-1 ${focusStyle}`}><span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">{preview ? "Preview" : "Your business"}</span><span className="block break-words text-base font-semibold leading-6 tracking-tight">{businessName}</span></Link>
            <details ref={menu} className="group relative shrink-0">
              <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-xs ${moreActive ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-600 hover:bg-slate-50"} ${focusStyle}`}>More<ChevronDown aria-hidden="true" className="size-3.5 transition group-open:rotate-180" /></summary>
              <div className="absolute right-0 top-full z-50 mt-2 max-h-[70dvh] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-900/10">
                <nav aria-label="More business navigation">{[...moreItems, ...other].map((item) => <Link key={item.href} href={item.href} onClick={closeMenu} aria-current={active(item) ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg px-3 text-sm ${active(item) ? "bg-blue-50 font-medium text-blue-800" : "text-slate-600 hover:bg-slate-50"} ${focusStyle}`}>{item.label}</Link>)}</nav>
                <div className="mt-2 border-t border-slate-100 px-3 py-3"><p className="break-words text-[11px] text-slate-400">{brandName}</p>{email ? <p className="mt-1 break-words text-xs text-slate-500">{email}</p> : null}{accountActions ? <div className="mt-3 [&_button]:min-h-11 [&_button]:w-full [&_button]:text-left">{accountActions}</div> : null}</div>
              </div>
            </details>
          </div>
          <nav aria-label="Business navigation" className="mt-2 grid grid-flow-col auto-cols-fr gap-1 pb-2">{phoneItems.map((item) => {
            const Icon = navigationIcons[item.label as keyof typeof navigationIcons] ?? House;
            return <Link key={item.href} href={item.href} aria-current={active(item) ? "page" : undefined} className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] ${active(item) ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-500 hover:bg-slate-50"} ${focusStyle}`}><Icon aria-hidden="true" className="size-4" />{item.label}</Link>;
          })}</nav>
        </header>
        <main id="workspace-content" tabIndex={-1} className="w-full max-w-6xl px-5 pt-7 pb-20 outline-none sm:px-8 lg:px-10 lg:pt-9 xl:px-12">{children}</main>
      </div>
    </div>
  </div>;
}
