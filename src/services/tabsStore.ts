import { invoke } from "@tauri-apps/api/core";
import type { ClaudeSession, PersistedTabsState } from "../types";
import { foldToolResultUserMessagesIntoAssistant } from "./claudeStreamAssembler";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";
import {
  getCurrentMainWorkspaceWindowLabel,
  isPrimaryMainWorkspaceWindowLabel,
  PRIMARY_MAIN_WINDOW_LABEL,
} from "./mainWindow";
import { isTauriIpcAlive } from "../utils/tauriEnv";
import { isCodexReasoningEffort } from "../constants/codexReasoningEffort";
import { isClaudeReasoningEffort } from "../constants/claudeReasoningEffort";
import { PERSIST_SESSION_MESSAGES_MAX } from "../constants/claudeMessageListWindow";

/** @deprecated 旧版全局 tabs 备份；仅主窗启动时迁入按窗键。 */
export const LEGACY_TABS_BACKUP_STORAGE_KEY = "wise.tabs.backup.v1";

const TABS_BACKUP_STORAGE_KEY_PREFIX = "wise.tabs.backup.v1:";

/** localStorage tabs 备份键：每个主工作区窗口独立，避免 main / main-dock 互相覆盖。 */
export function tabsBackupStorageKey(windowLabel: string | null | undefined): string {
  const raw = (windowLabel ?? PRIMARY_MAIN_WINDOW_LABEL).trim() || PRIMARY_MAIN_WINDOW_LABEL;
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${TABS_BACKUP_STORAGE_KEY_PREFIX}${safe}`;
}

export function resolveCurrentTabsBackupStorageKey(
  windowLabel: string | null | undefined = getCurrentMainWorkspaceWindowLabel(),
): string {
  return tabsBackupStorageKey(windowLabel);
}

/**
 * 读取并消费 localStorage tabs 备份。
 * 主窗兼容旧全局键；辅助窗只读本窗键。
 */
export function takeLocalTabsBackupRaw(
  windowLabel: string | null | undefined = getCurrentMainWorkspaceWindowLabel(),
): string | null {
  if (typeof localStorage === "undefined") return null;
  const scopedKey = tabsBackupStorageKey(windowLabel);
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped) {
      localStorage.removeItem(scopedKey);
      return scoped;
    }
    if (isPrimaryMainWorkspaceWindowLabel(windowLabel ?? PRIMARY_MAIN_WINDOW_LABEL)) {
      const legacy = localStorage.getItem(LEGACY_TABS_BACKUP_STORAGE_KEY);
      if (legacy) {
        localStorage.removeItem(LEGACY_TABS_BACKUP_STORAGE_KEY);
        return legacy;
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function writeLocalTabsBackupRaw(
  raw: string,
  windowLabel: string | null | undefined = getCurrentMainWorkspaceWindowLabel(),
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(tabsBackupStorageKey(windowLabel), raw);
  } catch {
    /* localStorage full or unavailable */
  }
}

export function normalizePersistedSession(raw: unknown): ClaudeSession {
  const v = raw as Record<string, unknown>;
  const out = { ...v } as Record<string, unknown>;
  delete out.projectPath;
  delete out.projectName;
  const rawPath = (typeof v.repositoryPath === "string" && v.repositoryPath) || String(v.projectPath ?? "");
  out.repositoryPath = normalizeSessionRepositoryPath(rawPath);
  out.repositoryName = (typeof v.repositoryName === "string" && v.repositoryName) || String(v.projectName ?? "");
  if (v.connectionKind === "streaming" || v.connectionKind === "oneshot") {
    out.connectionKind = v.connectionKind;
  }
  // `ultracodeEnabled` 必须是 boolean（per-session override）；脏值（字符串/null/对象）一律清除，
  // 避免运行时 `typeof !== "boolean"` 的额外分支污染。
  if (typeof v.ultracodeEnabled !== "boolean") {
    delete out.ultracodeEnabled;
  }
  if (!isCodexReasoningEffort(v.codexReasoningEffort)) {
    delete out.codexReasoningEffort;
  }
  if (!isClaudeReasoningEffort(v.claudeReasoningEffort)) {
    delete out.claudeReasoningEffort;
  }
  const session = out as unknown as ClaudeSession;
  if (Array.isArray(session.messages) && session.messages.length > 0) {
    return { ...session, messages: foldToolResultUserMessagesIntoAssistant(session.messages) };
  }
  return session;
}

/** 裁剪运行时字段并限制消息条数，供 tabs.json / localStorage 备份共用。 */
export function toPersistedTabsSessions(
  sessions: readonly ClaudeSession[],
  messagesMax: number = PERSIST_SESSION_MESSAGES_MAX,
): ClaudeSession[] {
  return sessions.map((session) => {
    const {
      diskTranscriptPartial: _omitPartial,
      transcriptMemoryUnlimited: _omitUnlimited,
      ...rest
    } = session;
    const messages =
      rest.messages.length <= messagesMax ? rest.messages : rest.messages.slice(-messagesMax);
    return {
      ...rest,
      repositoryPath: normalizeSessionRepositoryPath(rest.repositoryPath),
      messages,
    };
  });
}

export function buildPersistedTabsState(
  activeSessionId: string | null,
  sessions: readonly ClaudeSession[],
): PersistedTabsState {
  return {
    version: 1,
    activeSessionId,
    sessions: toPersistedTabsSessions(sessions),
  };
}

export async function loadSessionTabsState(): Promise<PersistedTabsState | null> {
  if (!isTauriIpcAlive()) return null;
  try {
    const windowLabel = getCurrentMainWorkspaceWindowLabel();
    const raw = await invoke<unknown>("load_session_tabs", { windowLabel });
    if (raw == null) return null;
    const o = raw as Record<string, unknown>;
    if (o.version !== 1 || !Array.isArray(o.sessions)) return null;
    return {
      version: 1,
      activeSessionId: typeof o.activeSessionId === "string" ? o.activeSessionId : null,
      sessions: o.sessions.map(normalizePersistedSession),
    };
  } catch {
    return null;
  }
}

type TabsPersistGate = {
  /** 串行链：同一窗口同时只跑一轮 drain，新写入合并进 pending。 */
  chain: Promise<void> | null;
  pending: PersistedTabsState | null;
  /** 单调递增；测试可观测合并写次数。 */
  generation: number;
  writeCount: number;
};

const tabsPersistGates = new Map<string, TabsPersistGate>();

function tabsPersistGateKey(windowLabel: string | null | undefined): string {
  const label = typeof windowLabel === "string" ? windowLabel.trim() : "";
  return label || "main";
}

function getTabsPersistGate(windowLabel: string | null | undefined): TabsPersistGate {
  const key = tabsPersistGateKey(windowLabel);
  let gate = tabsPersistGates.get(key);
  if (!gate) {
    gate = { chain: null, pending: null, generation: 0, writeCount: 0 };
    tabsPersistGates.set(key, gate);
  }
  return gate;
}

async function invokeSaveSessionTabs(
  state: PersistedTabsState,
  windowLabel: string | null,
): Promise<void> {
  if (!isTauriIpcAlive()) return;
  try {
    await invoke("save_session_tabs", { state, windowLabel });
  } catch {
    /* ignore — 卸载期 IPC 可能已死 */
  }
}

async function drainTabsPersistGate(
  gate: TabsPersistGate,
  windowLabel: string | null,
): Promise<void> {
  while (gate.pending) {
    const toWrite = gate.pending;
    gate.pending = null;
    await invokeSaveSessionTabs(toWrite, windowLabel);
    gate.writeCount += 1;
  }
}

/**
 * 保存 tabs.json：按窗口串行，飞行中的多次调用合并为「只落最新快照」。
 * 避免 debounce / visibility / beforeunload 并发 IPC 时旧写盖新写。
 */
export function saveSessionTabsState(state: PersistedTabsState): Promise<void> {
  if (!isTauriIpcAlive()) return Promise.resolve();
  const windowLabel = getCurrentMainWorkspaceWindowLabel();
  const gate = getTabsPersistGate(windowLabel);
  gate.pending = state;
  gate.generation += 1;

  if (!gate.chain) {
    gate.chain = drainTabsPersistGate(gate, windowLabel).finally(() => {
      gate.chain = null;
      // drain 结束后又有 pending（finally 竞态窗口）时再踢一轮。
      if (gate.pending != null) {
        void saveSessionTabsState(gate.pending);
      }
    });
  }
  return gate.chain;
}

/** @internal test helper */
export function resetSessionTabsPersistForTests(): void {
  tabsPersistGates.clear();
}

/** @internal test helper */
export function getSessionTabsPersistStatsForTests(windowLabel?: string | null): {
  generation: number;
  writeCount: number;
  hasPending: boolean;
  inFlight: boolean;
} {
  const gate = getTabsPersistGate(windowLabel ?? "main");
  return {
    generation: gate.generation,
    writeCount: gate.writeCount,
    hasPending: gate.pending != null,
    inFlight: gate.chain != null,
  };
}
