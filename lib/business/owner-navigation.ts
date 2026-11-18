export const OWNER_AREAS = [
  {
    label: "Today",
    href: "/client",
    exact: true,
    section: "action-center",
    icon: "home",
    group: "Your business",
  },
  {
    label: "Messages",
    href: "/client/messages",
    section: "automations",
    icon: "assistant",
    group: "Your business",
  },
  {
    label: "To-do",
    href: "/client/todo",
    section: "tasks",
    icon: "operations",
    group: "Your business",
  },
  {
    label: "Calendar",
    href: "/client/calendar",
    section: "schedule",
    icon: "activity",
    group: "Your business",
  },
  {
    label: "Money",
    href: "/client/money",
    section: "settings",
    icon: "activity",
    group: "Your business",
  },
  {
    label: "Manager",
    href: "/client/manager",
    section: "automations",
    icon: "assistant",
    group: "Your business",
  },
  {
    label: "Apps",
    href: "/client/apps",
    section: "settings",
    icon: "apps",
    group: "Your business",
  },
] as const;

export function isOwnerArea(pathname: string) {
  return (pathname === "/client" || pathname.startsWith("/client/")) &&
    !(pathname === "/client/mobile" || pathname === "/client/crm" || pathname.startsWith("/client/crm/"));
}
