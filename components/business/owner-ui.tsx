export const ownerQuietButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40";
export const ownerButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40";
export const ownerInput =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 disabled:opacity-40";

export function OwnerAreaHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-5">
      <h1 className="text-[30px] font-medium leading-tight tracking-[-0.035em]">
        {title}
      </h1>
      {children ? (
        <div className="flex items-center gap-2">{children}</div>
      ) : null}
    </header>
  );
}
