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
    label: "Manager",
    href: "/client/manager",
    section: "automations",
    icon: "assistant",
    group: "Your business",
  },
] as const;

export function isOwnerArea(pathname: string) {
  return (
    OWNER_AREAS.some((area) => area.href === pathname) ||
    ["/client/conversations", "/client/apps", "/client/calendar", "/client/money", "/client/customer-work"].includes(pathname)
  );
}
