import { setClaudeMcpServerEnabled } from "./claude";
import { backupFeedbackConfigPatchApply } from "./sessionFeedbackConfigPatchBackup";
import { readProjectRelativeFile, writeProjectRelativeFile } from "./projectRelativeFiles";
import type { FeedbackConfigPatch } from "../utils/sessionFeedbackConfigPatch";
import {
  mergeAppendSectionContent,
  previewPatchContent,
  resolveFeedbackConfigPatchPath,
} from "../utils/sessionFeedbackConfigPatch";

export interface ApplyFeedbackConfigPatchInput {
  repositoryPath: string;
  patch: FeedbackConfigPatch;
}

export interface ApplyFeedbackConfigPatchResult {
  patch: FeedbackConfigPatch;
  applied: boolean;
}

async function readCurrentFile(repositoryPath: string, relativePath: string): Promise<string | null> {
  try {
    return await readProjectRelativeFile(repositoryPath, relativePath);
  } catch {
    return null;
  }
}

/** 将单条配置补丁落盘（调用方须先完成用户审阅）。 */
export async function applyFeedbackConfigPatch(
  input: ApplyFeedbackConfigPatchInput,
): Promise<ApplyFeedbackConfigPatchResult> {
  const { repositoryPath } = input;
  const patch = resolveFeedbackConfigPatchPath(input.patch);
  const repo = repositoryPath.trim();
  if (!repo) {
    return {
      patch: { ...patch, status: "failed", errorMessage: "缺少仓库路径" },
      applied: false,
    };
  }

  try {
    if (patch.action === "enable" || patch.action === "disable") {
      const mcp = patch.mcp;
      if (!mcp?.serverName || !mcp.scope || !mcp.sourcePath) {
        throw new Error("MCP 补丁缺少 server 元数据");
      }
      const mcpWasEnabled = patch.action !== "enable";
      await setClaudeMcpServerEnabled({
        name: mcp.serverName,
        scope: mcp.scope,
        sourcePath: mcp.sourcePath,
        enabled: patch.action === "enable",
        repositoryPath: repo,
        claudeJsonProjectKey: mcp.claudeJsonProjectKey ?? null,
      });
      await backupFeedbackConfigPatchApply({
        repositoryPath: repo,
        patch,
        before: null,
        after: patch.action,
        mcpWasEnabled,
      });
      return {
        patch: { ...patch, status: "applied", appliedAt: Date.now() },
        applied: true,
      };
    }

    const before = await readCurrentFile(repo, patch.path);
    if (patch.action === "create" && before != null && before.trim().length > 0) {
      throw new Error(`文件已存在：${patch.path}`);
    }

    const nextContent = previewPatchContent(patch, before);
    await backupFeedbackConfigPatchApply({
      repositoryPath: repo,
      patch,
      before,
      after: nextContent,
    });
    await writeProjectRelativeFile(repo, patch.path, nextContent);

    return {
      patch: {
        ...patch,
        status: "applied",
        appliedAt: Date.now(),
        contentBefore: before ?? undefined,
      },
      applied: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      patch: { ...patch, status: "failed", errorMessage: message },
      applied: false,
    };
  }
}

/** 批量应用补丁，逐条执行并返回最新状态。 */
export async function applyFeedbackConfigPatches(input: {
  repositoryPath: string;
  patches: readonly FeedbackConfigPatch[];
}): Promise<FeedbackConfigPatch[]> {
  const results: FeedbackConfigPatch[] = [];
  for (const patch of input.patches) {
    if (patch.status !== "pending") {
      results.push(patch);
      continue;
    }
    const { patch: updated } = await applyFeedbackConfigPatch({
      repositoryPath: input.repositoryPath,
      patch,
    });
    results.push(updated);
  }
  return results;
}

/** 为审阅 UI 填充 contentBefore / 预览 after。 */
export async function enrichPatchWithPreview(
  repositoryPath: string,
  patch: FeedbackConfigPatch,
): Promise<{ before: string; after: string }> {
  const resolved = resolveFeedbackConfigPatchPath(patch);
  if (resolved.action === "enable" || resolved.action === "disable") {
    return { before: resolved.mcp?.serverName ?? "", after: resolved.action };
  }
  const before = (await readCurrentFile(repositoryPath, resolved.path)) ?? "";
  const after = previewPatchContent(resolved, before || null);
  return { before, after };
}

export { mergeAppendSectionContent };
