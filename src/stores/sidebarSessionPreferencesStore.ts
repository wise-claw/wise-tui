import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import type { ClaudeSession } from "../types";
import { normalizeRepositoryPathKey } from "../utils/repositoryMainSessionBinding";

const KEY = "wise.sidebar.sessionPreferences.v1";
export type SidebarSessionPreference = { pinned?: boolean; title?: string };
type Preferences = Record<string, SidebarSessionPreference>;
let snapshot: Preferences = {};
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
const listeners = new Set<() => void>();

// Wise IDs survive disk hydration; include the repository to isolate sidebar aliases.
export function sidebarSessionPreferenceKey(repositoryPath: string, session: Pick<ClaudeSession, "id">): string {
  return JSON.stringify([normalizeRepositoryPathKey(repositoryPath), session.id]);
}

export function parseSidebarSessionPreferences(raw: string | null): Preferences {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const item = value as SidebarSessionPreference;
      return [[key, { pinned: item.pinned === true, title: typeof item.title === "string" ? item.title.trim() : undefined }]];
    }));
  } catch { return {}; }
}

function load() {
  return loading ??= getAppSetting(KEY).then((raw) => {
    snapshot = parseSidebarSessionPreferences(raw);
    listeners.forEach((listener) => listener());
  });
}

export async function updateSidebarSessionPreference(key: string, patch: SidebarSessionPreference): Promise<void> {
  const write = writes.catch(() => {}).then(async () => {
    await load();
    const next = { ...snapshot, [key]: { ...snapshot[key], ...patch } };
    await setAppSetting(KEY, JSON.stringify(next));
    snapshot = next;
    listeners.forEach((listener) => listener());
  });
  writes = write;
  return write;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}
export function useSidebarSessionPreferences() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
