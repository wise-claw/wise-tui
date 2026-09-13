import { useSyncExternalStore } from "react";
import { WISE_UI_EVENT_AUTOMATION_PAUSE_CHANGED } from "../constants/workflowUiEvents";
import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

export const AUTOMATION_PAUSE_STORAGE_KEY = "wise.automation.pause.v1";

export interface AutomationPauseState {
  global: boolean;
  repositoryPaths: string[];
}

let snapshot: AutomationPauseState = { global: false, repositoryPaths: [] };
const listeners = new Set<() => void>();
let persistGeneration = 0;

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 订阅方异常不污染其他订阅方 */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WISE_UI_EVENT_AUTOMATION_PAUSE_CHANGED));
  }
}

function normalizeRepositoryPath(path: string): string {
  return path.trim();
}

export function parseAutomationPauseState(raw: unknown): AutomationPauseState {
  if (!raw || typeof raw !== "object") return { global: false, repositoryPaths: [] };
  const o = raw as Record<string, unknown>;
  const paths = Array.isArray(o.repositoryPaths)
    ? [
        ...new Set(
          o.repositoryPaths
            .filter((item): item is string => typeof item === "string")
            .map(normalizeRepositoryPath)
            .filter(Boolean),
        ),
      ].sort()
    : [];
  return {
    global: o.global === true,
    repositoryPaths: paths,
  };
}

function pauseStateEqual(a: AutomationPauseState, b: AutomationPauseState): boolean {
  if (a.global !== b.global) return false;
  if (a.repositoryPaths.length !== b.repositoryPaths.length) return false;
  return a.repositoryPaths.every((path, index) => path === b.repositoryPaths[index]);
}

function replaceSnapshot(next: AutomationPauseState): boolean {
  if (pauseStateEqual(snapshot, next)) return false;
  snapshot = next;
  emit();
  return true;
}

async function persist(next: AutomationPauseState): Promise<void> {
  persistGeneration += 1;
  replaceSnapshot(next);
  await setAppSettingJson(AUTOMATION_PAUSE_STORAGE_KEY, next);
}

export function getAutomationPauseSnapshot(): AutomationPauseState {
  return snapshot;
}

export function subscribeAutomationPause(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isGlobalAutomationPaused(): boolean {
  return snapshot.global;
}

export function isRepositoryAutomationPaused(repositoryPath: string): boolean {
  const path = normalizeRepositoryPath(repositoryPath);
  if (!path) return snapshot.global;
  return snapshot.global || snapshot.repositoryPaths.includes(path);
}

export async function hydrateAutomationPause(): Promise<AutomationPauseState> {
  const generation = persistGeneration;
  const raw = await getAppSettingJson<unknown>(AUTOMATION_PAUSE_STORAGE_KEY);
  if (generation !== persistGeneration) return snapshot;
  const parsed = parseAutomationPauseState(raw);
  replaceSnapshot(parsed);
  return snapshot;
}

export async function setGlobalAutomationPause(paused: boolean): Promise<AutomationPauseState> {
  const next: AutomationPauseState = {
    global: paused,
    repositoryPaths: snapshot.repositoryPaths,
  };
  await persist(next);
  return snapshot;
}

export async function setRepositoryAutomationPause(
  repositoryPath: string,
  paused: boolean,
): Promise<AutomationPauseState> {
  const path = normalizeRepositoryPath(repositoryPath);
  if (!path) return snapshot;
  const set = new Set(snapshot.repositoryPaths);
  if (paused) set.add(path);
  else set.delete(path);
  const next: AutomationPauseState = {
    global: snapshot.global,
    repositoryPaths: [...set].sort(),
  };
  await persist(next);
  return snapshot;
}

export function useAutomationPause(): AutomationPauseState {
  return useSyncExternalStore(
    subscribeAutomationPause,
    getAutomationPauseSnapshot,
    getAutomationPauseSnapshot,
  );
}

/** @internal test helper */
export function resetAutomationPauseStoreForTests(): void {
  snapshot = { global: false, repositoryPaths: [] };
  listeners.clear();
  persistGeneration = 0;
}
