import { setClaudeMcpServerEnabled } from "./claude";
import { writeProjectRelativeFile } from "./materializePrdSnapshot";
import type { FeedbackPatchBackupRecord } from "../utils/sessionFeedbackConfigPatchJson";

export interface RollbackFeedbackPatchResult {
  ok: boolean;
  message: string;
}

/** 从备份记录回滚单条配置补丁。 */
export async function rollbackFeedbackConfigPatchBackup(input: {
  repositoryPath: string;
  backup: FeedbackPatchBackupRecord;
}): Promise<RollbackFeedbackPatchResult> {
  const repo = input.repositoryPath.trim();
  if (!repo) return { ok: false, message: "缺少仓库路径" };

  const { backup } = input;

  try {
    if (backup.action === "enable" || backup.action === "disable") {
      const mcp = backup.mcp;
      if (!mcp?.serverName || !mcp.scope || !mcp.sourcePath) {
        return { ok: false, message: "MCP 备份缺少元数据，无法回滚" };
      }
      const restoreEnabled = backup.mcpWasEnabled ?? backup.action !== "enable";
      await setClaudeMcpServerEnabled({
        name: mcp.serverName,
        scope: mcp.scope,
        sourcePath: mcp.sourcePath,
        enabled: restoreEnabled,
        repositoryPath: repo,
        claudeJsonProjectKey: mcp.claudeJsonProjectKey ?? null,
      });
      return { ok: true, message: `已恢复 MCP「${mcp.serverName}」为 ${restoreEnabled ? "启用" : "禁用"}` };
    }

    if (backup.before == null) {
      return { ok: false, message: "备份无 before 内容，跳过回滚（避免误删新建文件）" };
    }

    await writeProjectRelativeFile(repo, backup.path, backup.before);
    return { ok: true, message: `已回滚 ${backup.path}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}
