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

/** @internal test helper */
export function resetWorkspaceRequirementsWriteQueueForTests(): void {
  requirementsWriteChain = Promise.resolve();
}
