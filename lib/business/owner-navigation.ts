/**
 * Meridian v1 is one operating pane. Today is where the owner reads and
 * approves; the other areas are optional full views of the same records, and
 * agents and apps work behind the scenes. The CRM stays in the background:
 * customer context appears inside decisions and customer search.
 */
export type OwnerAreaTier = "pane" | "full_view" | "behind_the_scenes";

export const OWNER_AREAS = [
  {
    label: "Today",
    href: "/client",
    exact: true,
    section: "action-center",
    icon: "home",
    group: "Your business",
    tier: "pane",
  },
  {
    label: "Messages",
    href: "/client/messages",
    section: "automations",
    icon: "assistant",
    group: "Your business",
    tier: "full_view",
  },
  {
    label: "Calendar",
    href: "/client/calendar",
    section: "schedule",
    icon: "activity",
    group: "Your business",
    tier: "full_view",
  },
  {
    label: "Money",
    href: "/client/money",
    section: "settings",
    icon: "activity",
    group: "Your business",
    tier: "full_view",
  },
  {
    label: "To-do",
    href: "/client/todo",
    section: "tasks",
    icon: "operations",
    group: "Your business",
    tier: "full_view",
  },
  {
    label: "Agents",
    href: "/client/manager",
    section: "automations",
    icon: "assistant",
    group: "Your business",
    tier: "behind_the_scenes",
  },
  {
    label: "Apps",
    href: "/client/apps",
    section: "settings",
    icon: "apps",
    group: "Your business",
    tier: "behind_the_scenes",
  },
] as const satisfies readonly { label: string; href: string; tier: OwnerAreaTier; [key: string]: unknown }[];

export const OWNER_AREA_TIER_LABELS: Record<Exclude<OwnerAreaTier, "pane">, string> = {
  full_view: "Full views",
  behind_the_scenes: "Behind the scenes",
};

/** Sample-only areas reachable from the pane (customer search) but not listed in navigation. */
export const PREVIEW_EXTRA_AREAS = ["customers", "report"] as const;

export function isOwnerArea(pathname: string) {
  return (pathname === "/client" || pathname.startsWith("/client/")) &&
    !(pathname === "/client/mobile" || pathname === "/client/crm" || pathname.startsWith("/client/crm/"));
}

/** The public sample mirrors owner areas under /preview with one path segment each. */
export function previewAreaHref(href: string) {
  if (href === "/client") return "/preview";
  const area = href.split("/").filter(Boolean).at(-1);
  return `/preview/${area}`;
}
