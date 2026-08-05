import { closeStreamingSession } from "../services/claude";
import {
  loadStreamingProcessReclaimConfig,
  streamingProcessReclaimPolicyFromConfig,
  type StreamingProcessReclaimConfig,
} from "../services/streamingProcessReclaimConfig";
import {
  selectStreamingTabsToReclaim,
  type StreamingProcessLiveEntry,
  type StreamingProcessReclaimSessionView,
} from "../utils/streamingProcessReclaimer";

export type StreamingProcessActivityEntry = {
  lastActivityAtMs: number;
  spawnedAtMs: number;
  pinned?: boolean;
};

export type StreamingProcessByTabEntry = {
  claudeSessionId: string | null;
};

/** 避免定时扫描与 spawn 前回收并发重入。 */
let reclaimInFlight: Promise<string[]> | null = null;

/** 单次回收最多关闭的进程数，避免 spawn 路径长时间阻塞。 */
const RECLAIM_CLOSE_BATCH_MAX = 4;

/** 登记或刷新活进程活动时间；首次登记时写入 spawnedAt。 */
export function touchStreamingProcessActivity(
  activityByTab: Map<string, StreamingProcessActivityEntry>,
  tabId: string,
  nowMs: number = Date.now(),
): void {
  const id = tabId.trim();
  if (!id) return;
  const prev = activityByTab.get(id);
  if (prev) {
    activityByTab.set(id, {
      ...prev,
      lastActivityAtMs: nowMs,
    });
    return;
  }
  activityByTab.set(id, {
    lastActivityAtMs: nowMs,
    spawnedAtMs: nowMs,
  });
}

export function forgetStreamingProcessActivity(
  activityByTab: Map<string, StreamingProcessActivityEntry>,
  tabId: string,
): void {
  activityByTab.delete(tabId.trim());
}

/** 登记活进程并刷新活动时间。 */
export function setStreamingProcessEntry(
  streamingProcessByTab: Map<string, StreamingProcessByTabEntry>,
  activityByTab: Map<string, StreamingProcessActivityEntry>,
  tabId: string,
  claudeSessionId: string | null,
  nowMs: number = Date.now(),
): void {
  const id = tabId.trim();
  if (!id) return;
  streamingProcessByTab.set(id, { claudeSessionId });
  touchStreamingProcessActivity(activityByTab, id, nowMs);
}

/** 移除活进程映射与活动时间戳。 */
export function deleteStreamingProcessEntry(
  streamingProcessByTab: Map<string, StreamingProcessByTabEntry>,
  activityByTab: Map<string, StreamingProcessActivityEntry>,
  tabId: string,
): void {
  const id = tabId.trim();
  if (!id) return;
  streamingProcessByTab.delete(id);
  forgetStreamingProcessActivity(activityByTab, id);
}

export function buildStreamingProcessLiveEntries(
  streamingProcessByTab: ReadonlyMap<string, StreamingProcessByTabEntry>,
  activityByTab: ReadonlyMap<string, StreamingProcessActivityEntry>,
  nowMs: number = Date.now(),
): StreamingProcessLiveEntry[] {
  const out: StreamingProcessLiveEntry[] = [];
  for (const [tabId, proc] of streamingProcessByTab) {
    const activity = activityByTab.get(tabId);
    out.push({
      tabId,
      claudeSessionId: proc.claudeSessionId,
      lastActivityAtMs: activity?.lastActivityAtMs ?? nowMs,
      spawnedAtMs: activity?.spawnedAtMs ?? nowMs,
      pinned: activity?.pinned,
    });
  }
  return out;
}

export function buildPendingControlCountByTabId(
  tabIds: readonly string[],
  getPendingCount: (tabId: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tabId of tabIds) {
    const n = getPendingCount(tabId);
    if (n > 0) map.set(tabId, n);
  }
  return map;
}

export type ApplyStreamingProcessReclaimParams = {
  nowMs?: number;
  config?: StreamingProcessReclaimConfig;
  reserveSlotForSpawn?: boolean;
  streamingProcessByTab: Map<string, StreamingProcessByTabEntry>;
  activityByTab: Map<string, StreamingProcessActivityEntry>;
  sessions: readonly StreamingProcessReclaimSessionView[];
  getPendingCount: (tabId: string) => number;
  /** 可选：回收后断开该 tab 的 session 流监听 */
  detachSessionStream?: (tabId: string) => void;
};

async function applyStreamingProcessReclaimUnlocked(
  params: ApplyStreamingProcessReclaimParams,
): Promise<string[]> {
  const config = params.config ?? (await loadStreamingProcessReclaimConfig());
  const policy = streamingProcessReclaimPolicyFromConfig(config);
  if (!policy.enabled) return [];

  const nowMs = params.nowMs ?? Date.now();
  const live = buildStreamingProcessLiveEntries(
    params.streamingProcessByTab,
    params.activityByTab,
    nowMs,
  );
  const pendingControlCountByTabId = buildPendingControlCountByTabId(
    live.map((e) => e.tabId),
    params.getPendingCount,
  );
  let tabIds = selectStreamingTabsToReclaim({
    nowMs,
    policy,
    live,
    sessions: params.sessions,
    pendingControlCountByTabId,
    reserveSlotForSpawn: params.reserveSlotForSpawn,
  });
  if (tabIds.length === 0) return [];
  if (tabIds.length > RECLAIM_CLOSE_BATCH_MAX) {
    tabIds = tabIds.slice(0, RECLAIM_CLOSE_BATCH_MAX);
  }

  // 决策后若用户已重新激活该 tab，跳过，避免误杀刚续聊的进程。
  const decidedAt = Date.now();
  tabIds = tabIds.filter((tabId) => {
    const activity = params.activityByTab.get(tabId);
    if (!activity) return true;
    return decidedAt - activity.lastActivityAtMs >= 1_000;
  });
  if (tabIds.length === 0) return [];

  const liveByTab = new Map(live.map((e) => [e.tabId, e]));

  // 先摘监听再杀进程：close_streaming_session 会发 success=false complete，避免仍挂着的 listener 误处理。
  for (const tabId of tabIds) {
    params.detachSessionStream?.(tabId);
  }

  await Promise.all(
    tabIds.map(async (tabId) => {
      const entry = liveByTab.get(tabId);
      const sid = entry?.claudeSessionId?.trim();
      if (sid) {
        await closeStreamingSession(sid).catch(() => {
          /* 进程可能已退出 */
        });
      }
      params.streamingProcessByTab.delete(tabId);
      params.activityByTab.delete(tabId);
    }),
  );
  return tabIds;
}

/**
 * 按策略回收空闲 / 超额长驻子进程；保留 Wise 标签，仅杀进程并清映射。
 * 同进程内串行化，避免定时扫描与 spawn 前回收并发。
 * @returns 已回收的 tabId 列表
 */
export async function applyStreamingProcessReclaim(
  params: ApplyStreamingProcessReclaimParams,
): Promise<string[]> {
  // 定时扫描若已有回收在飞，直接跳过，避免叠跑。
  if (reclaimInFlight && !params.reserveSlotForSpawn) {
    return [];
  }
  const previous = reclaimInFlight;
  const run = (async () => {
    if (previous) {
      await previous.catch(() => []);
    }
    return applyStreamingProcessReclaimUnlocked(params);
  })();
  reclaimInFlight = run.finally(() => {
    if (reclaimInFlight === run) reclaimInFlight = null;
  });
  return run;
}
