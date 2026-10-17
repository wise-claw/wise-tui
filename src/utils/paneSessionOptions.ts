import { buildWorkspaceSidebarTreeRows } from "./repositoryWorkspaceTree";
import { getSessionPreview } from "../components/ClaudeSessions/claudeChatHelpers";
import { sidebarSessionPreferenceKey, type SidebarSessionPreference } from "../stores/sidebarSessionPreferencesStore";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import type { ClaudeSession } from "../types";
import type { PaneSlot } from "../constants/mainLayoutWidths";

export interface PaneSessionOption { value: string; label: string; repositoryPath: string; disabled: boolean }

export function buildPaneSessionOptions(
  sessions: readonly ClaudeSession[], primaryId: string, slots: readonly PaneSlot[],
  preferences: Readonly<Record<string, SidebarSessionPreference>> = {},
): PaneSessionOption[] {
  const bound = new Set([primaryId, ...slots.map((slot) => slot.sessionId).filter(Boolean)]);
  const paths = new Set(sessions.map((session) => normalizeRepositoryPathKey(session.repositoryPath)).filter(Boolean));
  return [...paths].flatMap((repositoryPath) => {
    const rows = buildWorkspaceSidebarTreeRows({ sessions, repositoryPath, showRunItems: false });
    return rows.filter((row) => row.kind === "session")
      .sort((a, b) => Number(Boolean(preferences[sidebarSessionPreferenceKey(repositoryPath, b.item)]?.pinned))
        - Number(Boolean(preferences[sidebarSessionPreferenceKey(repositoryPath, a.item)]?.pinned)))
      .map(({ item: session }) => ({
        value: session.id,
        repositoryPath,
        label: preferences[sidebarSessionPreferenceKey(repositoryPath, session)]?.title || getSessionPreview(session),
        disabled: bound.has(session.id),
      }));
  });
}

/** 仅按仓库根路径匹配，不将同名仓库或子仓库混入当前分屏。 */
export function filterPaneSessionOptions(options: readonly PaneSessionOption[], repositoryPath: string): PaneSessionOption[] {
  const path = normalizeRepositoryPathKey(repositoryPath);
  if (!path) return [];
  return options.filter((option) => normalizeRepositoryPathKey(option.repositoryPath) === path);
}
