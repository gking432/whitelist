"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { OWNER_AREAS } from "@/lib/business/owner-navigation";
import type { WorkspaceNavItem } from "@/components/layout/workspace-navigation";

export function DailyBriefShell({
  children,
  brandName,
  clientName,
  email,
  navigation,
  banner,
  accountActions,
  preview = false,
}: {
  children: React.ReactNode;
  brandName: string;
  clientName: string;
  email: string;
  navigation: WorkspaceNavItem[];
  banner?: React.ReactNode;
  accountActions?: React.ReactNode;
  preview?: boolean;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const mainPaths = new Set<string>(
    OWNER_AREAS.map((area) =>
      preview ? area.href.replace("/client", "/preview") : area.href,
    ),
  );
  const primary = navigation.filter((item) => mainPaths.has(item.href));
  const connections = navigation.find(
    (item) => item.href === (preview ? "/preview/apps" : "/client/apps"),
  );
  const other = navigation.filter(
    (item) => !mainPaths.has(item.href) && item.href !== connections?.href,
  );
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <a href="#workspace-content" className="ns-skip-link">
        Skip to content
      </a>
      {banner}
      <header className="mx-auto flex min-h-20 max-w-5xl items-center justify-between gap-5 px-6 sm:px-10">
        <Link
          href={preview ? "/preview" : "/client"}
          title={clientName}
          className="truncate text-[13px] font-medium text-slate-500"
        >
          {brandName}
        </Link>
        <nav aria-label="Business navigation">
          <details ref={menu} className="group relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 hover:text-slate-900">
              Menu
              <ChevronDown className="size-3 transition group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-full z-40 max-h-[70dvh] w-60 overflow-y-auto rounded-xl border border-slate-100 bg-white p-2 shadow-lg shadow-slate-900/5">
              {primary.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={closeMenu}
                  className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 hover:text-slate-900 ${pathname === item.href ? "font-medium text-slate-900" : "text-slate-600"}`}
                >
                  {item.label === "Connect assistants"
                    ? "Apps & connections"
                    : item.label}
                </Link>
              ))}
              {connections ? (
                <Link
                  href={connections.href}
                  onClick={closeMenu}
                  className="mt-2 block border-t border-slate-100 px-3 pt-3 pb-2 text-xs text-slate-500 hover:text-slate-900"
                >
                  Apps & connections
                </Link>
              ) : null}
              {other.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
                    More tools
                  </summary>
                  <div className="py-1">
                    {other.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMenu}
                        className="block rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
              {email ? (
                <p
                  className="mt-2 truncate border-t border-slate-100 px-3 pt-3 pb-2 text-[11px] text-slate-400"
                  title={email}
                >
                  {email}
                </p>
              ) : null}
              {accountActions ? <div className="mt-2 border-t border-slate-100 px-3 pt-3 pb-2">{accountActions}</div> : null}
            </div>
          </details>
        </nav>
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="mx-auto max-w-5xl px-6 pt-12 pb-20 outline-none sm:px-10 sm:pt-20"
      >
        {children}
      </main>
    </div>
  );
}
