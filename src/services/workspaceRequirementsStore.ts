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

/** 是否已尝试从旧备忘录 Markdown 迁移一次 */
const WORKSPACE_REQUIREMENTS_MEMO_MIGRATED_KEY = "wise.workspaceRequirements.memoMigrated.v1";

export async function loadWorkspaceRequirements(): Promise<WorkspaceRequirementsPayloadV1> {
  const raw = await getAppSetting(WORKSPACE_REQUIREMENTS_SETTING_KEY);
  const payload = parseWorkspaceRequirementsPayload(raw);
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
    const next = mergeWorkspaceRequirementsPayload(seeded);
    await setAppSetting(WORKSPACE_REQUIREMENTS_SETTING_KEY, JSON.stringify(next));
    return next;
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
  const next = mergeWorkspaceRequirementsPayload(items);
  await setAppSetting(WORKSPACE_REQUIREMENTS_SETTING_KEY, JSON.stringify(next));
  return next;
}
