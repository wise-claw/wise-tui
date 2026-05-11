import { OMC_BATCH_HISTORY_SESSION_ID_PREFIX } from "../constants/omcMonitor";

const STORAGE_KEY = "wise.omc-batch-employee-history.v1";

/** 移除本地曾持久化的批量 OMC 占位会话列表（批量 OMC 不再写入 OMC 员工侧栏）。 */
export function clearPersistedOmcBatchHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function parseOmcBatchHistoryStubAnchorSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(OMC_BATCH_HISTORY_SESSION_ID_PREFIX)) return null;
  const rest = sessionId.slice(OMC_BATCH_HISTORY_SESSION_ID_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const enc = rest.slice(0, lastColon);
  try {
    const decoded = decodeURIComponent(enc).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

export function parseOmcBatchHistoryStubEpoch(sessionId: string): number | null {
  if (!sessionId.startsWith(OMC_BATCH_HISTORY_SESSION_ID_PREFIX)) return null;
  const rest = sessionId.slice(OMC_BATCH_HISTORY_SESSION_ID_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0 || lastColon >= rest.length - 1) return null;
  const n = Number(rest.slice(lastColon + 1));
  return Number.isFinite(n) ? n : null;
}

export function isOmcBatchHistoryStubSessionId(sessionId: string): boolean {
  return sessionId.trim().startsWith(OMC_BATCH_HISTORY_SESSION_ID_PREFIX);
}
