import type { ClaudeSession } from "../types";
import { isOmcBatchHistoryStubSessionId } from "./omcEmployeeBatchHistory";

/** 员工名归一化：兼容 `终端01` 与 `终端1`。 */
export function normalizeMonitorEmployeeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return trimmed;
  const prefix = match[1] ?? "";
  const digits = match[2] ?? "";
  const normalizedNumber = String(Number.parseInt(digits, 10));
  if (!Number.isFinite(Number.parseInt(digits, 10))) return trimmed;
  return `${prefix}${normalizedNumber}`;
}

function sessionUpdatedAtForSort(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
}

/** 历史列表仅展示可读会话：有消息；或仍在进行中的占位会话（仅 diskPreview）。 */
function shouldIncludeMonitorHistorySession(session: ClaudeSession): boolean {
  if (session.messages.length > 0) {
    return true;
  }
  // 占位会话仅在活跃态可见；异常/结束态若仍无消息会造成“点开即空白”的误导。
  if (session.status === "running" || session.status === "connecting") {
    return Boolean(session.diskPreview?.trim());
  }
  return false;
}

/** 监控侧栏「按员工名聚合历史会话」：从 repositoryName 取绑定名；批量 OMC 占位会话不参与聚合。 */
export function monitorBoundEmployeeNameFromSession(session: ClaudeSession): string | null {
  if (isOmcBatchHistoryStubSessionId(session.id)) {
    return null;
  }
  const repositoryName = session.repositoryName ?? "";
  const marker = "员工:";
  const idx = repositoryName.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const value = repositoryName.slice(idx + marker.length).trim();
  return value || null;
}

export function buildMonitorEmployeeHistorySessionsByName(sessions: ClaudeSession[]): Map<string, ClaudeSession[]> {
  const map = new Map<string, ClaudeSession[]>();
  for (const session of sessions) {
    if (isOmcBatchHistoryStubSessionId(session.id)) continue;
    if (!shouldIncludeMonitorHistorySession(session)) continue;
    const employeeNameRaw = monitorBoundEmployeeNameFromSession(session)?.trim();
    const employeeName = employeeNameRaw ? normalizeMonitorEmployeeName(employeeNameRaw) : "";
    if (!employeeName) continue;
    const list = map.get(employeeName) ?? [];
    list.push(session);
    map.set(employeeName, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => sessionUpdatedAtForSort(b) - sessionUpdatedAtForSort(a));
  }
  return map;
}

/**
 * 用于跳过 `buildMonitorEmployeeHistorySessionsByName` 的重复全量排序：
 * 仅纳入「员工绑定」会话；时间戳按 2s 分桶，流式输出在同一桶内视为结构未变。
 */
export function monitorEmployeeHistoryStructureFingerprint(sessions: ClaudeSession[]): string {
  const parts: string[] = [];
  for (const session of sessions) {
    if (isOmcBatchHistoryStubSessionId(session.id)) continue;
    if (!shouldIncludeMonitorHistorySession(session)) continue;
    const employeeNameRaw = monitorBoundEmployeeNameFromSession(session)?.trim();
    const employeeName = employeeNameRaw ? normalizeMonitorEmployeeName(employeeNameRaw) : "";
    if (!employeeName) continue;
    const lastMsg = session.messages[session.messages.length - 1];
    const lastTs = typeof lastMsg?.timestamp === "number" ? lastMsg.timestamp : session.createdAt;
    const tsBucket = Math.floor(lastTs / 2000);
    parts.push(
      `${session.id}\x1e${employeeName}\x1e${session.status}\x1e${session.messages.length}\x1e${tsBucket}\x1e${session.repositoryName ?? ""}`,
    );
  }
  parts.sort();
  return `${sessions.length}\x1f${parts.join("\x1d")}`;
}
