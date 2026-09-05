import Link from "next/link";
import {
  WorkspaceNavigation,
  WorkspaceHelpLink,
  type WorkspaceNavItem,
} from "@/components/layout/workspace-navigation";

type Props = {
  children: React.ReactNode;
  brand: React.ReactNode;
  home: string;
  workspaceName: string;
  roleLabel: string;
  userEmail: string;
  navigation: WorkspaceNavItem[];
  banner?: React.ReactNode;
  footer?: React.ReactNode;
  workspaceSwitcher?: boolean;
  help?: { href: string; label: string };
};

export function WorkspaceChrome({
  children,
  brand,
  home,
  workspaceName,
  roleLabel,
  userEmail,
  navigation,
  banner,
  footer,
  help,
  workspaceSwitcher = false,
}: Props) {
  return (
    <div className="min-h-screen bg-background">
      <a href="#workspace-content" className="ns-skip-link">
        Skip to content
      </a>
      {banner}
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r bg-card lg:block">
          <div className="sticky top-0 flex h-dvh flex-col">
            <Link
              href={home}
              className="flex min-h-20 items-center border-b px-6"
            >
              {brand}
            </Link>
            <div className="px-7 pb-1 pt-6">
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
              <p
                className="mt-1 truncate text-sm font-semibold"
                title={workspaceName}
              >
                {workspaceName}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              <WorkspaceNavigation items={navigation} />
            </div>
            <div className="space-y-4 border-t p-4">
              {workspaceSwitcher ? (
                <Link
                  href="/"
                  className="block rounded-md border px-3 py-2 text-sm font-medium hover:bg-secondary"
                >
                  Choose workspace
                </Link>
              ) : null}
              {help ? <WorkspaceHelpLink {...help} /> : null}
              <div className="flex items-center gap-3 px-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/8 text-sm font-semibold text-primary">
                  {userEmail.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium">Your account</p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={userEmail}
                  >
                    {userEmail}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 bg-card/95 backdrop-blur lg:hidden">
            <div className="flex min-h-16 items-center justify-between gap-4 px-5">
              <Link href={home} className="min-w-0">
                {brand}
              </Link>
              <span className="max-w-36 truncate text-xs text-muted-foreground">
                {workspaceName}
              </span>
            </div>
            {workspaceSwitcher ? (
              <Link
                href="/"
                className="block border-t px-5 py-2 text-xs font-medium"
              >
                Choose workspace
              </Link>
            ) : null}
            <WorkspaceNavigation items={navigation} mobile />
          </header>
          <main
            id="workspace-content"
            tabIndex={-1}
            className="ns-fade-up mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-9"
          >
            {children}
          </main>
          {footer ? (
            <footer className="border-t px-5 py-5 text-xs leading-6 text-muted-foreground lg:px-10">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}
