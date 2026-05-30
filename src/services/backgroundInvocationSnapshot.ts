/** 切换会话导致 ClaudeChat 卸载时，保留「后台 invocation」摘要与截断日志，切回后可恢复展示。 */
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  type BackgroundInvocationBundleChangedDetail,
  type WorkflowInvocationStreamDetail,
} from "../constants/workflowUiEvents";
import {
  BACKGROUND_INVOCATION_BUNDLE_MAX_ITEMS,
  DIRECT_BATCH_BUNDLE_SLIM_STDERR_LINES,
  DIRECT_BATCH_BUNDLE_SLIM_STDOUT_LINES,
  DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES,
  DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES,
} from "../constants/directBatchInvocationLog";
import {
  computeOmcDirectBatchFailurePreviewLine,
  computeOmcDirectBatchPreviewLine,
} from "../utils/claudeInvocationText";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

/** 同一会话下多路并行 OMC 的持久化快照集合 */
export interface InvocationSnapshotBundle {
  items: Record<string, BackgroundInvocationSnapshot>;
}

export interface BackgroundInvocationSnapshot {
  invocationKey: string;
  taskId?: string;
  templateId?: string;
  attempt?: number;
  phase: "running" | "done";
  success?: boolean;
  lineCount: number;
  errCount: number;
  previewLine?: string;
  /** 与 `WorkflowInvocationStreamDetail.dispatchPrompt` 一致，供抽屉展示 */
  dispatchPrompt?: string;
  stdoutLines: string[];
  stderrLines: string[];
  updatedAt: number;
}

const memory = new Map<string, BackgroundInvocationSnapshot>();
const STORAGE_PREFIX = "wise.bgInvocation.v1:";
const BUNDLE_PREFIX = "wise.bgInvocationBundle.v1:";
const memoryBundle = new Map<string, InvocationSnapshotBundle>();
const MAX_BUNDLE_ITEMS = BACKGROUND_INVOCATION_BUNDLE_MAX_ITEMS;
/** 模块内 LRU：限制同时驻留的「会话+仓库」快照键数量，避免切会话后内存只增不减。 */
const MAX_CACHED_SESSION_KEYS = 16;

function touchLruCache<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHED_SESSION_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function keyOf(sessionId: string, repositoryPath: string): string {
  return `${sessionId}@@${repositoryPath}`;
}

/** 去掉已关闭会话对应的 bundle / 单条快照内存缓存（磁盘 settings 不受影响）。 */
export function pruneInvocationSnapshotMemory(liveBundleKeys: ReadonlySet<string>): void {
  for (const key of [...memoryBundle.keys()]) {
    if (!liveBundleKeys.has(key)) {
      memoryBundle.delete(key);
    }
  }
  for (const key of [...memory.keys()]) {
    if (!liveBundleKeys.has(key)) {
      memory.delete(key);
    }
  }
}

export function collectInvocationSnapshotMemoryKeys(
  sessions: ReadonlyArray<{ id: string; repositoryPath?: string; claudeSessionId?: string | null }>,
): Set<string> {
  const keys = new Set<string>();
  for (const session of sessions) {
    const rp = session.repositoryPath?.trim();
    if (!rp) continue;
    keys.add(keyOf(session.id, rp));
    const claudeSid = session.claudeSessionId?.trim();
    if (claudeSid) keys.add(keyOf(claudeSid, rp));
  }
  return keys;
}

export async function readBackgroundInvocationSnapshot(
  sessionId: string,
  repositoryPath: string,
): Promise<BackgroundInvocationSnapshot | null> {
  const key = keyOf(sessionId, repositoryPath);
  const fromMem = memory.get(key);
  if (fromMem) {
    touchLruCache(memory, key, fromMem);
    return fromMem;
  }
  try {
    const raw = await getAppSetting(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackgroundInvocationSnapshot;
    if (!parsed || typeof parsed !== "object" || typeof parsed.invocationKey !== "string") return null;
    touchLruCache(memory, key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeBackgroundInvocationSnapshot(
  sessionId: string,
  repositoryPath: string,
  snapshot: BackgroundInvocationSnapshot,
): Promise<void> {
  const key = keyOf(sessionId, repositoryPath);
  touchLruCache(memory, key, snapshot);
  try {
    await setAppSettingJson(STORAGE_PREFIX + key, snapshot);
  } catch {
    const slim: BackgroundInvocationSnapshot = {
      ...snapshot,
      stdoutLines: snapshot.stdoutLines.slice(-DIRECT_BATCH_BUNDLE_SLIM_STDOUT_LINES),
      stderrLines: snapshot.stderrLines.slice(-DIRECT_BATCH_BUNDLE_SLIM_STDERR_LINES),
    };
    try {
      await setAppSettingJson(STORAGE_PREFIX + key, slim);
    } catch {
      /* 配额仍不足则仅保留内存 */
    }
  }
}

export async function clearBackgroundInvocationSnapshot(sessionId: string, repositoryPath: string): Promise<void> {
  const key = keyOf(sessionId, repositoryPath);
  memory.delete(key);
  try {
    await deleteAppSetting(STORAGE_PREFIX + key);
  } catch {
    /* noop */
  }
}

export async function readInvocationSnapshotBundle(sessionId: string, repositoryPath: string): Promise<InvocationSnapshotBundle> {
  const key = keyOf(sessionId, repositoryPath);
  const fromMem = memoryBundle.get(key);
  if (fromMem) {
    touchLruCache(memoryBundle, key, fromMem);
    return fromMem;
  }
  try {
    const raw = await getAppSetting(BUNDLE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as InvocationSnapshotBundle;
      if (parsed && typeof parsed.items === "object" && parsed.items !== null) {
        touchLruCache(memoryBundle, key, parsed);
        return parsed;
      }
    }
  } catch {
    /* noop */
  }
  const legacy = await readBackgroundInvocationSnapshot(sessionId, repositoryPath);
  if (legacy) {
    const bundle: InvocationSnapshotBundle = { items: { [legacy.invocationKey]: legacy } };
    touchLruCache(memoryBundle, key, bundle);
    return bundle;
  }
  return { items: {} };
}

export async function writeInvocationSnapshotBundle(
  sessionId: string,
  repositoryPath: string,
  bundle: InvocationSnapshotBundle,
): Promise<void> {
  const key = keyOf(sessionId, repositoryPath);
  touchLruCache(memoryBundle, key, bundle);
  try {
    await setAppSettingJson(BUNDLE_PREFIX + key, bundle);
  } catch {
    const slimItems: Record<string, BackgroundInvocationSnapshot> = {};
    for (const [ik, snap] of Object.entries(bundle.items)) {
      slimItems[ik] = {
        ...snap,
        stdoutLines: snap.stdoutLines.slice(-DIRECT_BATCH_BUNDLE_SLIM_STDOUT_LINES),
        stderrLines: snap.stderrLines.slice(-DIRECT_BATCH_BUNDLE_SLIM_STDERR_LINES),
      };
    }
    try {
      await setAppSettingJson(BUNDLE_PREFIX + key, { items: slimItems });
    } catch {
      /* 配额仍不足则仅保留内存 */
    }
  }
}

export async function mergeInvocationSnapshotIntoBundle(
  sessionId: string,
  repositoryPath: string,
  snapshot: BackgroundInvocationSnapshot,
): Promise<void> {
  const bundle = await readInvocationSnapshotBundle(sessionId, repositoryPath);
  const nextItems = { ...bundle.items, [snapshot.invocationKey]: snapshot };
  const entries = Object.entries(nextItems)
    .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
    .slice(0, MAX_BUNDLE_ITEMS);
  await writeInvocationSnapshotBundle(sessionId, repositoryPath, { items: Object.fromEntries(entries) });
}

/** 与 `claude.ts` 直连批量环形缓冲、`OmcDirectBatchInvocationDetailDrawer` 解析行上限对齐 */
const MAX_DIRECT_BATCH_SNAPSHOT_STDOUT = DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES;
const MAX_DIRECT_BATCH_SNAPSHOT_STDERR = DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES;
const MAX_DIRECT_BATCH_SNAPSHOT_PROMPT_CHARS = 100_000;

/**
 * 将直连批量 OMC 单路子进程结果并入锚点会话的后台快照 bundle，并通知当前打开的该会话标签刷新列表。
 */
export async function persistDirectBatchInvocationSnapshotForAnchorSession(params: {
  anchorSessionId: string;
  repositoryPath: string;
  invocationKey: string;
  taskId?: string;
  templateId?: string;
  attempt?: number;
  stdoutLines: string[];
  stderrLines: string[];
  success: boolean;
  dispatchPromptRaw?: string;
}): Promise<void> {
  const sid = params.anchorSessionId.trim();
  const rp = params.repositoryPath.trim();
  const ik = params.invocationKey.trim();
  if (!sid || !rp || !ik) return;

  const rawPrompt = params.dispatchPromptRaw?.trim() ?? "";
  const dispatchPrompt =
    rawPrompt.length > MAX_DIRECT_BATCH_SNAPSHOT_PROMPT_CHARS
      ? `${rawPrompt.slice(0, MAX_DIRECT_BATCH_SNAPSHOT_PROMPT_CHARS)}\n…[truncated for storage]`
      : rawPrompt || undefined;

  const stdoutLines = params.stdoutLines.slice(-MAX_DIRECT_BATCH_SNAPSHOT_STDOUT);
  const stderrLines = params.stderrLines.slice(-MAX_DIRECT_BATCH_SNAPSHOT_STDERR);
  const previewLine = params.success
    ? computeOmcDirectBatchPreviewLine(stdoutLines, stderrLines, 140)
    : computeOmcDirectBatchFailurePreviewLine(stdoutLines, stderrLines, 140);

  const snapshot: BackgroundInvocationSnapshot = {
    invocationKey: ik,
    taskId: params.taskId,
    templateId: params.templateId,
    attempt: params.attempt,
    phase: "done",
    success: params.success,
    lineCount: params.stdoutLines.length,
    errCount: params.stderrLines.length,
    ...(previewLine ? { previewLine } : {}),
    dispatchPrompt,
    stdoutLines,
    stderrLines,
    updatedAt: Date.now(),
  };

  await mergeInvocationSnapshotIntoBundle(sid, rp, snapshot);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<BackgroundInvocationBundleChangedDetail>(WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED, {
        detail: { sessionId: sid, repositoryPath: rp },
      }),
    );
  }
}

/**
 * 将侧栏/持久化列表中的直连批量行与锚点 bundle 对齐：`phase` 仍为 started 但 bundle 已落盘时升为 complete，
 * 避免刷新后列表与执行详情抽屉不一致。
 */
export async function reconcileDirectBatchInvocationRowsWithBundles(
  rows: readonly WorkflowInvocationStreamDetail[],
): Promise<WorkflowInvocationStreamDetail[]> {
  const bundleCache = new Map<string, InvocationSnapshotBundle>();
  async function bundleFor(sid: string, rp: string): Promise<InvocationSnapshotBundle> {
    const k = keyOf(sid, rp);
    let b = bundleCache.get(k);
    if (!b) {
      b = await readInvocationSnapshotBundle(sid, rp);
      bundleCache.set(k, b);
    }
    return b;
  }

  const out: WorkflowInvocationStreamDetail[] = [];
  for (const inv of rows) {
    if (inv.omcInvocationSource !== "direct_batch") {
      out.push(inv);
      continue;
    }
    if (inv.phase === "complete") {
      out.push(inv);
      continue;
    }
    const sid = inv.sessionId.trim();
    const rp = inv.repositoryPath.trim();
    if (!sid || !rp) {
      out.push(inv);
      continue;
    }
    const bundle = await bundleFor(sid, rp);
    const snap = bundle.items[inv.invocationKey];
    const hasPersisted =
      snap?.phase === "done" ||
      (Array.isArray(snap?.stdoutLines) && snap.stdoutLines.length > 0) ||
      (Array.isArray(snap?.stderrLines) && snap.stderrLines.length > 0);
    if (hasPersisted) {
      out.push({
        ...inv,
        phase: "complete",
        success: typeof snap?.success === "boolean" ? snap.success : inv.success,
        lineCount: snap?.lineCount ?? inv.lineCount,
        errCount: snap?.errCount ?? inv.errCount,
        ...(snap?.previewLine ? { previewLine: snap.previewLine } : inv.previewLine ? { previewLine: inv.previewLine } : {}),
      });
    } else {
      out.push(inv);
    }
  }
  return out;
}

export async function clearInvocationSnapshotBundle(sessionId: string, repositoryPath: string): Promise<void> {
  const key = keyOf(sessionId, repositoryPath);
  memoryBundle.delete(key);
  try {
    await deleteAppSetting(BUNDLE_PREFIX + key);
  } catch {
    /* noop */
  }
  await clearBackgroundInvocationSnapshot(sessionId, repositoryPath);
}
