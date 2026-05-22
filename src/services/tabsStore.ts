import { invoke } from "@tauri-apps/api/core";
import type { ClaudeSession, PersistedTabsState } from "../types";

function normalizePersistedSession(raw: unknown): ClaudeSession {
  const v = raw as Record<string, unknown>;
  const out = { ...v } as Record<string, unknown>;
  delete out.projectPath;
  delete out.projectName;
  out.repositoryPath = (typeof v.repositoryPath === "string" && v.repositoryPath) || String(v.projectPath ?? "");
  out.repositoryName = (typeof v.repositoryName === "string" && v.repositoryName) || String(v.projectName ?? "");
  if (v.connectionKind === "streaming" || v.connectionKind === "oneshot") {
    out.connectionKind = v.connectionKind;
  }
  return out as unknown as ClaudeSession;
}

export async function loadSessionTabsState(): Promise<PersistedTabsState | null> {
  try {
    const raw = await invoke<unknown>("load_session_tabs");
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
  try {
    await invoke("save_session_tabs", { state });
  } catch {
    /* ignore */
  }
}
