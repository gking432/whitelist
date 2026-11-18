import type { DailyWorkSection } from "./focus-brief.ts";
import { WORKSPACE_MODULES, type WorkspaceActivity, type WorkspaceModule, type WorkspacePreferences } from "./workspace-preferences-contract.ts";

export function defaultWorkspacePreferences(): WorkspacePreferences {
  return { revision: 0, displayName: null, order: [...WORKSPACE_MODULES], pinned: [] };
}

export function parseWorkspacePreferences(value: unknown): WorkspacePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "displayName,order,pinned,revision") return null;
  if (!Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0) return null;
  const displayName = candidate.displayName;
  if (displayName !== null && (typeof displayName !== "string" || displayName !== displayName.trim() || displayName.length < 1 || displayName.length > 60 || /\p{Cc}/u.test(displayName))) return null;
  const isModule = (module: unknown): module is WorkspaceModule => typeof module === "string" && (WORKSPACE_MODULES as readonly string[]).includes(module);
  if (!Array.isArray(candidate.order) || candidate.order.length !== WORKSPACE_MODULES.length || !candidate.order.every(isModule) || new Set(candidate.order).size !== WORKSPACE_MODULES.length) return null;
  if (!Array.isArray(candidate.pinned) || !candidate.pinned.every(isModule) || new Set(candidate.pinned).size !== candidate.pinned.length) return null;
  return { revision: Number(candidate.revision), displayName: displayName as string | null, order: [...candidate.order], pinned: [...candidate.pinned] };
}

function sectionModule(key: string): WorkspaceModule | null {
  switch (key) {
    case "messages": case "intake": return "messages";
    case "appointments": return "appointments";
    case "todo": return "todo";
    case "invoices": case "connected-invoices": return "money";
    default: return null;
  }
}

export function orderDailySections(sections: readonly DailyWorkSection[], preferences?: WorkspacePreferences | null): DailyWorkSection[] {
  const prefs = parseWorkspacePreferences(preferences) ?? defaultWorkspacePreferences();
  const pinned = new Set(prefs.pinned);
  const modules = [...prefs.order.filter((module) => pinned.has(module)), ...prefs.order.filter((module) => !pinned.has(module))];
  const rank = (section: DailyWorkSection) => {
    if (section.key === "attention") return 0;
    if (section.key === "money-source-review") return 1;
    const workspaceModule = sectionModule(section.key);
    return workspaceModule ? 2 + modules.indexOf(workspaceModule) : 2 + modules.length;
  };
  // Sorting sections never changes their rows, source evidence or urgent state.
  return sections.filter((section) => section.rows.length > 0).map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index).map(({ section }) => section);
}

export function recommendWorkspaceFocus(sections: readonly DailyWorkSection[], activity: readonly WorkspaceActivity[]): WorkspaceModule | null {
  const present = new Set(sections.filter((section) => section.rows.length > 0).map((section) => sectionModule(section.key)).filter((module) => module !== null));
  const days = new Map<WorkspaceModule, number>();
  for (const entry of activity) {
    if (!present.has(entry.module) || !Number.isSafeInteger(entry.days) || entry.days < 3 || entry.days > 14) continue;
    // Repeated aggregate rows cannot manufacture additional distinct days.
    days.set(entry.module, Math.max(days.get(entry.module) ?? 0, entry.days));
  }
  const candidates = [...days].sort((a, b) => b[1] - a[1]);
  if (!candidates.length || candidates[1]?.[1] === candidates[0][1]) return null;
  return candidates[0][0];
}
