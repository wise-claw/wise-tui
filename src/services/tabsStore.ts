import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ClaudeSession, PersistedTabsState } from "../types";
import { foldToolResultUserMessagesIntoAssistant } from "./claudeStreamAssembler";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";
import { getCurrentMainWorkspaceWindowLabel } from "./mainWindow";

/**
 * `visibilitychange` / `beforeunload` 在 webview 关闭/刷新时可能晚于 IPC 桥销毁，
 * 此时继续 `invoke` 会让 fetch 走到已被 Tauri runtime 收回的 ACL 路由，抛
 * "Fetch API cannot load ipc://... due to access control checks"。
 * 直接检查底层 `__TAURI_INTERNALS__`，比 `isTauri()` 更精准（它只判断注入标识，不反映运行时存活）。
 */
function isTauriIpcAlive(): boolean {
  if (!isTauri()) return false;
  // Tauri 2.x 把内部 invoke / metadata 挂在 window.__TAURI_INTERNALS__ 上；
  // webview 销毁 / IPC 桥关闭时该对象会被设为 undefined。
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ !==
      "undefined"
  );
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
  const session = out as unknown as ClaudeSession;
  if (Array.isArray(session.messages) && session.messages.length > 0) {
    return { ...session, messages: foldToolResultUserMessagesIntoAssistant(session.messages) };
  }
  return session;
}

export async function loadSessionTabsState(): Promise<PersistedTabsState | null> {
  if (!isTauri()) return null;
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

export async function saveSessionTabsState(state: PersistedTabsState): Promise<void> {
  if (!isTauri()) return;
  if (!isTauriIpcAlive()) return;
  try {
    const windowLabel = getCurrentMainWorkspaceWindowLabel();
    await invoke("save_session_tabs", { state, windowLabel });
  } catch {
    /* ignore */
  }
}
