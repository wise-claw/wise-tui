/**
 * 长驻 streaming 子进程自动回收决策（纯函数）。
 * 真正杀进程由调用方走 closeStreamingSession / 清 streamingProcessByTab。
 */

export type StreamingProcessReclaimSessionStatus =
  | "idle"
  | "connecting"
  | "running"
  | "completed"
  | "cancelled"
  | "error";

export type StreamingProcessLiveEntry = {
  tabId: string;
  /** Claude / 引擎侧 session id；缺省时仍可按 tab 回收映射 */
  claudeSessionId: string | null;
  lastActivityAtMs: number;
  spawnedAtMs: number;
  pinned?: boolean;
};

export type StreamingProcessReclaimSessionView = {
  id: string;
  status: StreamingProcessReclaimSessionStatus;
};

export type StreamingProcessReclaimPolicy = {
  enabled: boolean;
  /** 空闲超过该毫秒数可回收 */
  idleMs: number;
  /** 全局最多同时存活的 streaming 子进程数 */
  maxLiveProcesses: number;
  /** spawn 后宽限期内不因空闲 TTL 回收 */
  graceMs: number;
};

export type StreamingProcessReclaimDecisionInput = {
  nowMs: number;
  policy: StreamingProcessReclaimPolicy;
  live: readonly StreamingProcessLiveEntry[];
  sessions: readonly StreamingProcessReclaimSessionView[];
  /** tabId → 未完成 AskUserQuestion / permission 等控制请求数 */
  pendingControlCountByTabId: ReadonlyMap<string, number>;
  /**
   * 即将再 spawn 一个新进程时传入 true：在已达上限时多腾 1 个空闲槽。
   * 定时空闲扫描传 false。
   */
  reserveSlotForSpawn?: boolean;
};

function isExecutingStatus(status: StreamingProcessReclaimSessionStatus): boolean {
  return status === "running" || status === "connecting";
}

export function isStreamingProcessProtectedFromReclaim(input: {
  entry: StreamingProcessLiveEntry;
  session: StreamingProcessReclaimSessionView | undefined;
  pendingControlCount: number;
  nowMs: number;
  graceMs: number;
}): boolean {
  if (input.entry.pinned) return true;
  if (input.nowMs - input.entry.spawnedAtMs < input.graceMs) return true;
  if (input.session && isExecutingStatus(input.session.status)) return true;
  if (input.pendingControlCount > 0) return true;
  return false;
}

function resolveSession(
  sessions: readonly StreamingProcessReclaimSessionView[],
  tabId: string,
): StreamingProcessReclaimSessionView | undefined {
  return sessions.find((s) => s.id === tabId);
}

function pendingForTab(
  pendingControlCountByTabId: ReadonlyMap<string, number>,
  tabId: string,
): number {
  return pendingControlCountByTabId.get(tabId) ?? 0;
}

/** 空闲 TTL：可回收的 tab（按最久未活动优先）。 */
export function selectIdleStreamingTabsToReclaim(
  input: StreamingProcessReclaimDecisionInput,
): string[] {
  if (!input.policy.enabled || input.policy.idleMs <= 0) return [];
  const out: StreamingProcessLiveEntry[] = [];
  for (const entry of input.live) {
    const session = resolveSession(input.sessions, entry.tabId);
    if (
      isStreamingProcessProtectedFromReclaim({
        entry,
        session,
        pendingControlCount: pendingForTab(input.pendingControlCountByTabId, entry.tabId),
        nowMs: input.nowMs,
        graceMs: input.policy.graceMs,
      })
    ) {
      continue;
    }
    if (input.nowMs - entry.lastActivityAtMs < input.policy.idleMs) continue;
    out.push(entry);
  }
  out.sort((a, b) => a.lastActivityAtMs - b.lastActivityAtMs || a.tabId.localeCompare(b.tabId));
  return out.map((e) => e.tabId);
}

/**
 * 全局活进程上限：在已达 maxLive（或为 spawn 预留槽）时，按 LRU 选出可驱逐的空闲进程。
 * 无法腾出足够槽位时返回尽最大努力的列表（不强制杀执行中进程）。
 */
export function selectLruStreamingTabsToEvictForCap(
  input: StreamingProcessReclaimDecisionInput,
): string[] {
  if (!input.policy.enabled || input.policy.maxLiveProcesses <= 0) return [];
  const reserve = input.reserveSlotForSpawn ? 1 : 0;
  const over = input.live.length - input.policy.maxLiveProcesses + reserve;
  if (over <= 0) return [];

  const candidates: StreamingProcessLiveEntry[] = [];
  for (const entry of input.live) {
    const session = resolveSession(input.sessions, entry.tabId);
    if (
      isStreamingProcessProtectedFromReclaim({
        entry,
        session,
        pendingControlCount: pendingForTab(input.pendingControlCountByTabId, entry.tabId),
        nowMs: input.nowMs,
        graceMs: input.policy.graceMs,
      })
    ) {
      continue;
    }
    candidates.push(entry);
  }
  candidates.sort(
    (a, b) => a.lastActivityAtMs - b.lastActivityAtMs || a.tabId.localeCompare(b.tabId),
  );
  return candidates.slice(0, over).map((e) => e.tabId);
}

/** 合并 TTL + 容量驱逐，去重且保持 LRU 优先顺序。 */
export function selectStreamingTabsToReclaim(
  input: StreamingProcessReclaimDecisionInput,
): string[] {
  if (!input.policy.enabled) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tabId of [
    ...selectIdleStreamingTabsToReclaim(input),
    ...selectLruStreamingTabsToEvictForCap(input),
  ]) {
    if (seen.has(tabId)) continue;
    seen.add(tabId);
    out.push(tabId);
  }
  return out;
}
