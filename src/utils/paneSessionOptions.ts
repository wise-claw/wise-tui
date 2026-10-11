import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import type { ClaudeSession } from "../types";
import type { PaneSlot } from "../constants/mainLayoutWidths";

export interface PaneSessionOption { value: string; label: string; repositoryPath: string; disabled: boolean }

export function buildPaneSessionOptions(sessions: readonly ClaudeSession[], primaryId: string, slots: readonly PaneSlot[]): PaneSessionOption[] {
  const bound = new Set([primaryId, ...slots.map((slot) => slot.sessionId).filter(Boolean)]);
  const unique = new Map(sessions.map((session) => [session.id, session]));
  return [...unique.values()]
    .sort((a, b) => (b.diskUpdatedAtMs ?? b.createdAt) - (a.diskUpdatedAtMs ?? a.createdAt))
    .map((session) => {
      const firstInput = session.messages.find((msg) => msg.role === "user")?.content;
      const title = session.threadName?.trim() || session.diskPreview?.trim() || firstInput?.trim() || "新会话";
      return { value: session.id, repositoryPath: session.repositoryPath, label: title.replace(/\s+/g, " ").slice(0, 80), disabled: bound.has(session.id) };
    });
}

/** 仅按仓库根路径匹配，不将同名仓库或子仓库混入当前分屏。 */
export function filterPaneSessionOptions(options: readonly PaneSessionOption[], repositoryPath: string): PaneSessionOption[] {
  const path = normalizeRepositoryPathKey(repositoryPath);
  if (!path) return [];
  return options.filter((option) => normalizeRepositoryPathKey(option.repositoryPath) === path);
}
