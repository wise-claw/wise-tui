import { getAppSetting, setAppSetting } from "./appSettingsStore";
import { getWorkspaceGlobalMemoDb } from "./workspaceInspectorDb";
import {
  extractRequirementsFromMemoMarkdown,
  mergeWorkspaceRequirementsPayload,
  parseWorkspaceRequirementsPayload,
  type WorkspaceRequirementItem,
  type WorkspaceRequirementsPayloadV1,
} from "../types/workspaceRequirements";

/** 全局需求列表（SQLite app_settings） */
export const WORKSPACE_REQUIREMENTS_SETTING_KEY = "wise.workspaceRequirements.v1";

/** 需求列表落库后广播，供需求面板刷新（全局新增弹窗与面板列表解耦）。 */
export const WISE_WORKSPACE_REQUIREMENTS_CHANGED = "wise:workspace-requirements-changed";

/** 需求模块自动派发总开关（app_settings）。 */
export const WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_KEY = "wise.workspaceRequirements.autoDispatch.v1";

/** 自动派发开关变化广播；detail 为最新开关值。 */
export const WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED =
  "wise:workspace-requirements-auto-dispatch-changed";

/** 自动派发并发数上限（app_settings）。 */
export const WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_KEY =
  "wise.workspaceRequirements.autoDispatchConcurrency.v1";

/** 自动派发并发数默认值 / 下限（上限放开，由用户自由设置）。 */
export const WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_DEFAULT = 2;
export const WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN = 1;

/** 自动派发并发数变化广播；detail 为最新值。 */
export const WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED =
  "wise:workspace-requirements-auto-dispatch-concurrency-changed";

/** 是否已尝试从旧备忘录 Markdown 迁移一次 */
const WORKSPACE_REQUIREMENTS_MEMO_MIGRATED_KEY = "wise.workspaceRequirements.memoMigrated.v1";

/** 串行化所有写路径，避免 load→merge→save 与整表覆盖互相踩踏。 */
let requirementsWriteChain: Promise<unknown> = Promise.resolve();

function enqueueRequirementsWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = requirementsWriteChain.then(task, task);
  requirementsWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dispatchRequirementsChanged(next: WorkspaceRequirementsPayloadV1): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceRequirementsPayloadV1>(WISE_WORKSPACE_REQUIREMENTS_CHANGED, {
      detail: next,
    }),
  );
}

async function readRequirementsPayload(): Promise<WorkspaceRequirementsPayloadV1> {
  const raw = await getAppSetting(WORKSPACE_REQUIREMENTS_SETTING_KEY);
  return parseWorkspaceRequirementsPayload(raw);
}

async function writeRequirementsPayload(
  items: WorkspaceRequirementItem[],
): Promise<WorkspaceRequirementsPayloadV1> {
  const next = mergeWorkspaceRequirementsPayload(items);
  await setAppSetting(WORKSPACE_REQUIREMENTS_SETTING_KEY, JSON.stringify(next));
  dispatchRequirementsChanged(next);
  return next;
}

export async function loadWorkspaceRequirements(): Promise<WorkspaceRequirementsPayloadV1> {
  const payload = await readRequirementsPayload();
  if (payload.items.length > 0) {
    return payload;
  }

  const migrated = await getAppSetting(WORKSPACE_REQUIREMENTS_MEMO_MIGRATED_KEY);
  if (migrated === "1") {
    return payload;
  }

  try {
    const memo = await getWorkspaceGlobalMemoDb();
    const seeded = extractRequirementsFromMemoMarkdown(memo.bodyMarkdown);
    await setAppSetting(WORKSPACE_REQUIREMENTS_MEMO_MIGRATED_KEY, "1");
    if (seeded.length === 0) {
      return payload;
    }
    // 迁移写入走同一写队列，避免与并发 append/save 交错。
    return enqueueRequirementsWrite(() => writeRequirementsPayload(seeded));
  } catch {
    try {
      await setAppSetting(WORKSPACE_REQUIREMENTS_MEMO_MIGRATED_KEY, "1");
    } catch {
      /* ignore */
    }
    return payload;
  }
}

/** 读取需求自动派发开关。 */
export async function getWorkspaceRequirementAutoDispatch(): Promise<boolean> {
  const raw = await getAppSetting(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_KEY);
  return raw === "1";
}

/** 写入需求自动派发开关并广播，供两个需求面板与派发引擎同步。 */
export async function setWorkspaceRequirementAutoDispatch(enabled: boolean): Promise<void> {
  await setAppSetting(
    WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_KEY,
    enabled ? "1" : "0",
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<boolean>(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED, {
        detail: enabled,
      }),
    );
  }
}

/** 读取自动派发并发数（仅收敛下限）。 */
export async function getWorkspaceRequirementAutoDispatchConcurrency(): Promise<number> {
  const raw = await getAppSetting(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_KEY);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_DEFAULT;
  }
  return Math.max(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN, Math.round(value));
}

/** 写入自动派发并发数并广播。 */
export async function setWorkspaceRequirementAutoDispatchConcurrency(value: number): Promise<void> {
  const normalized = Math.max(
    WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN,
    Math.round(value),
  );
  await setAppSetting(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_KEY, String(normalized));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<number>(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED, {
        detail: normalized,
      }),
    );
  }
}

export async function saveWorkspaceRequirements(
  items: WorkspaceRequirementItem[],
): Promise<WorkspaceRequirementsPayloadV1> {
  return enqueueRequirementsWrite(() => writeRequirementsPayload(items));
}

/**
 * 在写锁内读改写追加一条需求，避免「弹窗 load + 面板整表 save」丢条目。
 */
export async function appendWorkspaceRequirement(
  item: WorkspaceRequirementItem,
): Promise<WorkspaceRequirementsPayloadV1> {
  return enqueueRequirementsWrite(async () => {
    const current = await readRequirementsPayload();
    return writeRequirementsPayload([...current.items, item]);
  });
}

/**
 * 在写锁内按 id 更新一条需求，避免弹窗与面板整表覆盖互相踩踏。
 */
export async function updateWorkspaceRequirement(
  id: string,
  updater: (item: WorkspaceRequirementItem) => WorkspaceRequirementItem,
): Promise<WorkspaceRequirementsPayloadV1> {
  return enqueueRequirementsWrite(async () => {
    const current = await readRequirementsPayload();
    let found = false;
    const next = current.items.map((row) => {
      if (row.id !== id) return row;
      found = true;
      return updater(row);
    });
    if (!found) {
      throw new Error("未找到要更新的需求");
    }
    return writeRequirementsPayload(next);
  });
}

/**
 * 会话执行完成且执行结果表明需求确实被处理时，把关联需求标记为「待验证」（等待人工验证完成）。
 * 幂等：已完成的（done）需求不会被倒回待验证。
 */
export async function markWorkspaceRequirementVerifying(id: string): Promise<void> {
  try {
    await updateWorkspaceRequirement(id, (row) =>
      row.status === "done"
        ? row
        : { ...row, status: "verifying", updatedAt: Date.now() },
    );
  } catch (err) {
    // 需求可能在会话运行期间被删除/整表覆盖，忽略即可。
    console.error("[WorkspaceRequirements] mark verifying failed", err);
  }
}

/** 会话失败或未实际处理需求时保持/恢复为待办；人工已确认完成的需求不回退。 */
export async function markWorkspaceRequirementOpen(id: string): Promise<void> {
  try {
    await updateWorkspaceRequirement(id, (row) =>
      row.status === "done"
        ? row
        // 状态回退不算用户编辑，不能改 updatedAt，否则自动派发会把失败任务当成新需求无限重试。
        : { ...row, status: "open" },
    );
  } catch (err) {
    // 需求可能在会话运行期间被删除/整表覆盖，忽略即可。
    console.error("[WorkspaceRequirements] mark open failed", err);
  }
}

/** 需求派发创建会话后写入双向关联，供需求详情直接跳转到对应执行窗口。 */
export async function bindWorkspaceRequirementExecutionSession(
  requirementId: string,
  sessionId: string,
): Promise<void> {
  const requirement = requirementId.trim();
  const session = sessionId.trim();
  if (!requirement || !session) return;
  try {
    await updateWorkspaceRequirement(requirement, (row) =>
      row.executionSessionIds.includes(session)
        ? row
        : { ...row, executionSessionIds: [...row.executionSessionIds, session] },
    );
  } catch (err) {
    // 会话可能在需求删除后才创建；不影响执行本身。
    console.error("[WorkspaceRequirements] bind execution session failed", err);
  }
}

/** @internal test helper */
export function resetWorkspaceRequirementsWriteQueueForTests(): void {
  requirementsWriteChain = Promise.resolve();
}
