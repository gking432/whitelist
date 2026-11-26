import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";

type NorthstarMarkProps = {
  className?: string;
  // "dark" renders for dark-green surfaces, "light" for parchment surfaces.
  surface?: "dark" | "light";
  subtitle?: string;
};

export function NorthstarMark({
  className,
  surface = "dark",
  subtitle,
}: NorthstarMarkProps) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-gold text-brand-deep shadow-sm">
        <Compass className="size-4" aria-hidden="true" strokeWidth={2.25} />
      </span>
      <span className="leading-tight">
        <span
          className={cn(
            "block text-sm font-semibold tracking-tight",
            surface === "dark" ? "text-white" : "text-foreground",
          )}
        >
          Northstar
        </span>
        {subtitle ? (
          <span
            className={cn(
              "block text-[11px]",
              surface === "dark"
                ? "text-sidebar-foreground/60"
                : "text-muted-foreground",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
