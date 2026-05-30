/**
 * 将侧栏「直连批量 OMC」invocation 列表持久化：优先 `localStorage`（WebView / 纯前端均可用），
 * 并写入应用设置作备份；刷新后可恢复（与内存 store 同源）。
 */
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

/** 与 `get_app_setting` 键一致；`localStorage` 使用同一键名 */
const STORAGE_KEY = "wise.omcDirectBatchInvocations.v1";
export const MAX_PERSISTED_OMC_DIRECT_BATCH_ITEMS = 40;
const MAX_PERSISTED_ITEMS = MAX_PERSISTED_OMC_DIRECT_BATCH_ITEMS;

/** 仓库成员 invocation 内存 store 上限（保留全部 running + 最近 complete） */
export const MAX_REPOSITORY_MEMBER_INVOCATIONS_IN_MEMORY = 48;

/** OMC workflow 批量 runtime Map 上限 */
export const MAX_OMC_WORKFLOW_INVOCATIONS_IN_MEMORY = 32;
const MAX_DISPATCH_PROMPT_CHARS = 48_000;

let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 640;

export function sortOmcDirectBatchInvocationsForStore(list: WorkflowInvocationStreamDetail[]): WorkflowInvocationStreamDetail[] {
  return [...list].sort((a, b) => {
    const ta = typeof a.attempt === "number" ? a.attempt : 0;
    const tb = typeof b.attempt === "number" ? b.attempt : 0;
    return ta - tb;
  });
}

/** 内存 Map 与持久化层共用同一上限，避免 direct batch invocation 只增不减。 */
export function trimOmcDirectBatchInvocationMap(
  map: Map<string, WorkflowInvocationStreamDetail>,
  maxItems: number = MAX_PERSISTED_ITEMS,
): void {
  if (map.size <= maxItems) return;
  const keepKeys = new Set(
    sortOmcDirectBatchInvocationsForStore([...map.values()])
      .slice(-maxItems)
      .map((inv) => inv.invocationKey),
  );
  for (const key of [...map.keys()]) {
    if (!keepKeys.has(key)) {
      map.delete(key);
    }
  }
}

function isInvocationRunning(inv: WorkflowInvocationStreamDetail): boolean {
  return inv.phase !== "complete";
}

function trimInvocationDetailMap(
  map: Map<string, WorkflowInvocationStreamDetail>,
  maxItems: number,
): void {
  if (map.size <= maxItems) return;
  const running: WorkflowInvocationStreamDetail[] = [];
  const completed: WorkflowInvocationStreamDetail[] = [];
  for (const inv of map.values()) {
    if (isInvocationRunning(inv)) {
      running.push(inv);
    } else {
      completed.push(inv);
    }
  }
  completed.sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0));
  const maxCompleted = Math.max(0, maxItems - running.length);
  const keepKeys = new Set(
    [...running, ...completed.slice(0, maxCompleted)].map((inv) => inv.invocationKey),
  );
  for (const key of [...map.keys()]) {
    if (!keepKeys.has(key)) {
      map.delete(key);
    }
  }
}

export function trimRepositoryMemberInvocationMap(
  map: Map<string, WorkflowInvocationStreamDetail>,
  maxItems: number = MAX_REPOSITORY_MEMBER_INVOCATIONS_IN_MEMORY,
): void {
  trimInvocationDetailMap(map, maxItems);
}

export function trimOmcWorkflowInvocationRuntimeMap(
  map: Map<string, WorkflowInvocationStreamDetail>,
  maxItems: number = MAX_OMC_WORKFLOW_INVOCATIONS_IN_MEMORY,
): void {
  trimInvocationDetailMap(map, maxItems);
}

export function capWorkflowInvocationStreamDetailsForMemory(
  list: WorkflowInvocationStreamDetail[],
  maxItems: number = MAX_REPOSITORY_MEMBER_INVOCATIONS_IN_MEMORY,
): WorkflowInvocationStreamDetail[] {
  if (list.length <= maxItems) return list;
  const running = list.filter(isInvocationRunning);
  const completed = list.filter((inv) => !isInvocationRunning(inv));
  completed.sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0));
  const maxCompleted = Math.max(0, maxItems - running.length);
  return [...running, ...completed.slice(0, maxCompleted)];
}

export function digestOmcDirectBatchInvocationsList(list: WorkflowInvocationStreamDetail[]): string {
  const sorted = sortOmcDirectBatchInvocationsForStore(list);
  return sorted
    .map((d) => {
      const pl = d.previewLine ?? "";
      const plShort = pl.length > 96 ? pl.slice(0, 96) : pl;
      return [
        d.invocationKey,
        d.phase,
        d.lineCount ?? 0,
        d.errCount ?? 0,
        d.ownerRepositoryId ?? "",
        d.repositoryType ?? "",
        d.stage ?? "",
        d.subagentType ?? "",
        plShort,
      ].join("\t");
    })
    .join("\n");
}

export function serializeOmcDirectBatchInvocationForPersistence(
  inv: WorkflowInvocationStreamDetail,
): WorkflowInvocationStreamDetail {
  const raw = inv.dispatchPrompt?.trim() ?? "";
  const dispatchPrompt =
    raw.length > MAX_DISPATCH_PROMPT_CHARS ? `${raw.slice(0, MAX_DISPATCH_PROMPT_CHARS)}\n…[truncated]` : raw || undefined;
  return {
    invocationKey: inv.invocationKey,
    phase: inv.phase,
    sessionId: inv.sessionId,
    repositoryPath: inv.repositoryPath,
    omcInvocationSource: inv.omcInvocationSource === "direct_batch" ? "direct_batch" : undefined,
    taskId: inv.taskId,
    taskTitle: inv.taskTitle,
    templateId: inv.templateId,
    attempt: inv.attempt,
    ownerKind: inv.ownerKind,
    ownerRepositoryId: inv.ownerRepositoryId,
    ownerRepositoryName: inv.ownerRepositoryName,
    ownerRepositoryPath: inv.ownerRepositoryPath,
    repositoryType: inv.repositoryType,
    stage: inv.stage,
    subagentType: inv.subagentType,
    lineCount: inv.lineCount,
    errCount: inv.errCount,
    previewLine: inv.previewLine,
    success: inv.success,
    ...(inv.subprocessSessionId?.trim() ? { subprocessSessionId: inv.subprocessSessionId.trim() } : {}),
    ...(dispatchPrompt ? { dispatchPrompt } : {}),
  };
}

function readLocalStorageRaw(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocalStorageRaw(json: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* 私密模式 / 配额 */
  }
}

function removeLocalStorageRaw(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function parsePersistedOmcDirectBatchInvocationRow(raw: unknown): WorkflowInvocationStreamDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const invocationKey = typeof o.invocationKey === "string" ? o.invocationKey.trim() : "";
  const sessionId = typeof o.sessionId === "string" ? o.sessionId.trim() : "";
  const repositoryPath = typeof o.repositoryPath === "string" ? o.repositoryPath.trim() : "";
  const phase = o.phase;
  if (!invocationKey || !sessionId || !repositoryPath) return null;
  if (phase !== "started" && phase !== "progress" && phase !== "complete") return null;
  const taskId = typeof o.taskId === "string" ? o.taskId : undefined;
  const taskTitle = typeof o.taskTitle === "string" ? o.taskTitle : undefined;
  const templateId = typeof o.templateId === "string" ? o.templateId : undefined;
  const attempt = typeof o.attempt === "number" && Number.isFinite(o.attempt) ? o.attempt : undefined;
  const ownerKind = o.ownerKind === "repository" ? "repository" : undefined;
  const ownerRepositoryId =
    typeof o.ownerRepositoryId === "number" && Number.isFinite(o.ownerRepositoryId)
      ? o.ownerRepositoryId
      : undefined;
  const ownerRepositoryName = typeof o.ownerRepositoryName === "string" ? o.ownerRepositoryName : undefined;
  const ownerRepositoryPath = typeof o.ownerRepositoryPath === "string" ? o.ownerRepositoryPath : undefined;
  const repositoryType =
    o.repositoryType === "frontend" || o.repositoryType === "backend" || o.repositoryType === "document"
      ? o.repositoryType
      : undefined;
  const stage = typeof o.stage === "string" ? o.stage : undefined;
  const subagentType = typeof o.subagentType === "string" ? o.subagentType : undefined;
  const lineCount = typeof o.lineCount === "number" && Number.isFinite(o.lineCount) ? o.lineCount : undefined;
  const errCount = typeof o.errCount === "number" && Number.isFinite(o.errCount) ? o.errCount : undefined;
  const previewLine = typeof o.previewLine === "string" ? o.previewLine : undefined;
  const success = typeof o.success === "boolean" ? o.success : undefined;
  const dispatchPrompt = typeof o.dispatchPrompt === "string" ? o.dispatchPrompt : undefined;
  const subprocessSessionId =
    typeof o.subprocessSessionId === "string" && o.subprocessSessionId.trim().length > 0
      ? o.subprocessSessionId.trim()
      : undefined;
  return {
    invocationKey,
    phase,
    sessionId,
    repositoryPath,
    omcInvocationSource: "direct_batch",
    ...(taskId ? { taskId } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(templateId ? { templateId } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(ownerKind ? { ownerKind } : {}),
    ...(ownerRepositoryId !== undefined ? { ownerRepositoryId } : {}),
    ...(ownerRepositoryName ? { ownerRepositoryName } : {}),
    ...(ownerRepositoryPath ? { ownerRepositoryPath } : {}),
    ...(repositoryType ? { repositoryType } : {}),
    ...(stage ? { stage } : {}),
    ...(subagentType ? { subagentType } : {}),
    ...(lineCount !== undefined ? { lineCount } : {}),
    ...(errCount !== undefined ? { errCount } : {}),
    ...(previewLine ? { previewLine } : {}),
    ...(success !== undefined ? { success } : {}),
    ...(subprocessSessionId ? { subprocessSessionId } : {}),
    ...(dispatchPrompt ? { dispatchPrompt } : {}),
  };
}

function parsePersistedJsonPayload(raw: string): WorkflowInvocationStreamDetail[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const rows: WorkflowInvocationStreamDetail[] = [];
  for (const item of parsed) {
    const inv = parsePersistedOmcDirectBatchInvocationRow(item);
    if (inv) rows.push(inv);
  }
  return sortOmcDirectBatchInvocationsForStore(rows).slice(-MAX_PERSISTED_ITEMS);
}

/** 同步从 `localStorage` 恢复（首帧即可用，不依赖 Tauri invoke） */
export function loadOmcDirectBatchInvocationsFromLocalStorageSync(): WorkflowInvocationStreamDetail[] {
  const raw = readLocalStorageRaw();
  if (!raw) return [];
  try {
    return parsePersistedJsonPayload(raw);
  } catch {
    return [];
  }
}

export async function loadOmcDirectBatchInvocationsPersisted(): Promise<WorkflowInvocationStreamDetail[]> {
  try {
    const fromLs = readLocalStorageRaw();
    if (fromLs) {
      try {
        return parsePersistedJsonPayload(fromLs);
      } catch {
        /* 损坏则回退应用设置 */
      }
    }
    const raw = await getAppSetting(STORAGE_KEY);
    if (!raw) return [];
    return parsePersistedJsonPayload(raw);
  } catch {
    return [];
  }
}

export async function clearOmcDirectBatchInvocationsPersisted(): Promise<void> {
  if (persistDebounceTimer != null) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  removeLocalStorageRaw();
  try {
    await deleteAppSetting(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

function buildPersistedOmcDirectBatchJson(
  list: WorkflowInvocationStreamDetail[],
): { json: string; slim: WorkflowInvocationStreamDetail[] } | null {
  const sorted = sortOmcDirectBatchInvocationsForStore(list).slice(-MAX_PERSISTED_ITEMS);
  const slim = sorted.map(serializeOmcDirectBatchInvocationForPersistence);
  if (slim.length === 0) return null;
  try {
    return { json: JSON.stringify(slim), slim };
  } catch {
    return null;
  }
}

/** 同步写入 localStorage；pagehide / visibility hidden 时使用，避免 unload 阶段 IPC 被拦截。 */
export function flushPersistOmcDirectBatchInvocationsLocal(list: WorkflowInvocationStreamDetail[]): void {
  cancelOmcDirectBatchInvocationsPersistSchedule();
  const payload = buildPersistedOmcDirectBatchJson(list);
  if (!payload) {
    removeLocalStorageRaw();
    return;
  }
  writeLocalStorageRaw(payload.json);
}

export async function flushPersistOmcDirectBatchInvocations(
  list: WorkflowInvocationStreamDetail[],
  options?: { persistAppSetting?: boolean },
): Promise<void> {
  cancelOmcDirectBatchInvocationsPersistSchedule();
  const payload = buildPersistedOmcDirectBatchJson(list);
  if (!payload) {
    removeLocalStorageRaw();
    if (options?.persistAppSetting !== false) {
      try {
        await deleteAppSetting(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
    return;
  }
  writeLocalStorageRaw(payload.json);
  if (options?.persistAppSetting === false) return;
  const { slim } = payload;
  try {
    await setAppSettingJson(STORAGE_KEY, slim);
  } catch {
    try {
      const minimal = slim.map((inv) => ({
        ...inv,
        dispatchPrompt: inv.dispatchPrompt ? `${inv.dispatchPrompt.slice(0, 8000)}\n…[truncated]` : undefined,
      }));
      await setAppSettingJson(STORAGE_KEY, minimal);
      try {
        writeLocalStorageRaw(JSON.stringify(minimal));
      } catch {
        /* noop */
      }
    } catch {
      /* 应用设置失败时仍保留 localStorage */
    }
  }
}

export function cancelOmcDirectBatchInvocationsPersistSchedule(): void {
  if (persistDebounceTimer != null) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
}

export function schedulePersistOmcDirectBatchInvocations(list: WorkflowInvocationStreamDetail[]): void {
  if (persistDebounceTimer != null) {
    clearTimeout(persistDebounceTimer);
  }
  const snapshot = list;
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    void flushPersistOmcDirectBatchInvocations(snapshot);
  }, PERSIST_DEBOUNCE_MS);
}
