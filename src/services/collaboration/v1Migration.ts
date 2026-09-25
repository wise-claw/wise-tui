import { getClaudeSessionsSnapshot } from "../../stores/claudeSessionsLiveStore";
import { reloadWorkspaceRequirementsFromStorage } from "../workspaceRequirementsStore";
import { importCollabV1 } from "./ipc";
import type { CollabImportReport } from "../../types/collaboration";

/**
 * 旧单仓库需求升级到协作层：Rust 事务内导入并回写迁移标记，完成后刷新前端需求列表。
 * 仍在运行的旧会话作为历史尝试接管，不重新派发。
 */
export async function upgradeWorkspaceRequirementsToCollab(input: { itemIds?: string[] } = {}): Promise<CollabImportReport> {
  const runningSessionIds = getClaudeSessionsSnapshot()
    .filter((s) => s.status === "running")
    .map((s) => s.id);
  const report = await importCollabV1({ itemIds: input.itemIds, runningSessionIds });
  await reloadWorkspaceRequirementsFromStorage();
  return report;
}

export function describeCollabImportReport(report: CollabImportReport): string {
  const parts = [`共 ${report.total} 条，新导入 ${report.imported.length} 条`];
  if (report.skipped.length) parts.push(`已存在跳过 ${report.skipped.length} 条`);
  if (report.needsTarget.length) parts.push(`${report.needsTarget.length} 条需要补齐目标仓库`);
  if (report.boundRunningSessions.length) parts.push(`接管运行中会话 ${report.boundRunningSessions.length} 个`);
  return parts.join("，");
}
