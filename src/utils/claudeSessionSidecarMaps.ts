import type { ClaudeSession } from "../types";

export interface ClaudeSessionSidecarMaps {
  sessionIdMap: Map<string, string>;
  expectedTurnNonceByTabId: Map<string, number>;
  assistantStreamTextByTab: Map<string, string>;
  lastStreamLineBySession: Map<string, { line: string; at: number }>;
  lastStreamTextBySession: Map<string, { text: string; at: number }>;
  registryBootstrapDeadlineByClaudeSid: Map<string, number>;
  streamingProcessByTab: Map<string, { claudeSessionId: string | null }>;
  streamingSessionStreamDetachByTab: Map<string, () => void>;
  diskLoadDone: Set<string>;
  diskTailLinesBySession: Map<string, number>;
  executeSessionRetryCount: Map<string, number>;
  workflowRunBySession: Map<string, string>;
  trellisContextIdBySession: Map<string, string>;
  streamStallHookExtendedByTab: Set<string>;
}

/** 活动标签 id + claude session_id，供 sidecar Map 对账。 */
export function collectLiveSessionSidecarKeys(sessions: readonly ClaudeSession[]): Set<string> {
  const keys = new Set<string>();
  for (const session of sessions) {
    keys.add(session.id);
    const claudeSid = session.claudeSessionId?.trim();
    if (claudeSid) keys.add(claudeSid);
  }
  return keys;
}

function deleteOrphanMapKey(map: Map<string, unknown>, key: string, liveKeys: ReadonlySet<string>): boolean {
  if (liveKeys.has(key)) return false;
  map.delete(key);
  return true;
}

/** 去掉已关闭/被磁盘裁剪标签遗留的 sidecar 条目，避免 Map 只增不减。 */
export function pruneOrphanClaudeSessionSidecarMaps(
  maps: ClaudeSessionSidecarMaps,
  liveKeys: ReadonlySet<string>,
): boolean {
  let changed = false;
  const now = Date.now();

  for (const key of [...maps.expectedTurnNonceByTabId.keys()]) {
    if (deleteOrphanMapKey(maps.expectedTurnNonceByTabId, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.assistantStreamTextByTab.keys()]) {
    if (deleteOrphanMapKey(maps.assistantStreamTextByTab, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.lastStreamLineBySession.keys()]) {
    if (deleteOrphanMapKey(maps.lastStreamLineBySession, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.lastStreamTextBySession.keys()]) {
    if (deleteOrphanMapKey(maps.lastStreamTextBySession, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.diskTailLinesBySession.keys()]) {
    if (deleteOrphanMapKey(maps.diskTailLinesBySession, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.executeSessionRetryCount.keys()]) {
    if (deleteOrphanMapKey(maps.executeSessionRetryCount, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.workflowRunBySession.keys()]) {
    if (deleteOrphanMapKey(maps.workflowRunBySession, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.trellisContextIdBySession.keys()]) {
    if (deleteOrphanMapKey(maps.trellisContextIdBySession, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.streamingProcessByTab.keys()]) {
    if (deleteOrphanMapKey(maps.streamingProcessByTab, key, liveKeys)) changed = true;
  }
  for (const key of [...maps.diskLoadDone]) {
    if (!liveKeys.has(key)) {
      maps.diskLoadDone.delete(key);
      changed = true;
    }
  }
  for (const key of [...maps.streamStallHookExtendedByTab]) {
    if (!liveKeys.has(key)) {
      maps.streamStallHookExtendedByTab.delete(key);
      changed = true;
    }
  }
  for (const [temp, real] of [...maps.sessionIdMap.entries()]) {
    if (!liveKeys.has(temp) && !liveKeys.has(real)) {
      maps.sessionIdMap.delete(temp);
      changed = true;
    }
  }
  for (const [key, detach] of [...maps.streamingSessionStreamDetachByTab.entries()]) {
    if (liveKeys.has(key)) continue;
    detach();
    maps.streamingSessionStreamDetachByTab.delete(key);
    changed = true;
  }
  for (const [key, until] of [...maps.registryBootstrapDeadlineByClaudeSid.entries()]) {
    if (!liveKeys.has(key) || until <= now) {
      maps.registryBootstrapDeadlineByClaudeSid.delete(key);
      changed = true;
    }
  }

  return changed;
}
