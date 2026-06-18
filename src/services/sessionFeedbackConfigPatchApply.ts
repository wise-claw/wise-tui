import { setClaudeMcpServerEnabled, readClaudeAutoMemoryFile, saveClaudeAutoMemoryFile, getClaudeMemoryStatus } from "./claude";
import { backupFeedbackConfigPatchApply } from "./sessionFeedbackConfigPatchBackup";
import { readProjectRelativeFile, writeProjectRelativeFile } from "./projectRelativeFiles";
import {
  OPEN_WORKSPACE_ERROR,
  openRepositoryEntryInPreferredEditor,
  resolvePreferredEditorOpenAppTarget,
} from "./openWorkspaceWithPreference";
import { openWorkspaceIn } from "./repository";
import type { FeedbackConfigPatch } from "../utils/sessionFeedbackConfigPatch";
import {
  CLAUDE_AUTO_MEMORY_PATCH_PATH,
  mergeAppendSectionContent,
  previewPatchContent,
  resolveFeedbackConfigPatchPath,
  resolveFeedbackConfigPatchFileTarget,
  type FeedbackConfigPatchFileTarget,
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

    const before =
      patch.kind === "memory" || patch.path === CLAUDE_AUTO_MEMORY_PATCH_PATH
        ? await readClaudeAutoMemoryFile(repo).catch(() => null)
        : await readCurrentFile(repo, patch.path);
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
    if (patch.kind === "memory" || patch.path === CLAUDE_AUTO_MEMORY_PATCH_PATH) {
      await saveClaudeAutoMemoryFile({ content: nextContent, repositoryPath: repo });
    } else {
      await writeProjectRelativeFile(repo, patch.path, nextContent);
    }

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
  const before =
    resolved.kind === "memory" || resolved.path === CLAUDE_AUTO_MEMORY_PATCH_PATH
      ? ((await readClaudeAutoMemoryFile(repositoryPath).catch(() => "")) ?? "")
      : ((await readCurrentFile(repositoryPath, resolved.path)) ?? "");
  const after = previewPatchContent(resolved, before || null);
  return { before, after };
}

async function openAbsolutePathInPreferredEditor(absolutePath: string): Promise<void> {
  const target = resolvePreferredEditorOpenAppTarget();
  if (!target) {
    throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  }
  if (target.kind === "command") {
    const cmd = (target.command ?? "").trim();
    if (!cmd) throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
    await openWorkspaceIn(absolutePath, { command: cmd, args: target.args, gotoLine: 1, gotoColumn: 1 });
    return;
  }
  const appName = (target.appName ?? "").trim();
  if (!appName) throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  await openWorkspaceIn(absolutePath, { appName, args: target.args, gotoLine: 1, gotoColumn: 1 });
}

/** 解析 memory 补丁的绝对路径（供展示与打开）。 */
export async function enrichFeedbackConfigPatchFileTarget(
  patch: FeedbackConfigPatch,
  repositoryPath?: string | null,
  base?: FeedbackConfigPatchFileTarget,
): Promise<FeedbackConfigPatchFileTarget> {
  const target = base ?? resolveFeedbackConfigPatchFileTarget(patch, repositoryPath);
  if (target.openKind !== "memory") return target;
  try {
    const status = await getClaudeMemoryStatus(repositoryPath ?? null);
    const memoryFile =
      status.files.find(
        (f) => f.kind === "auto_memory" && /MEMORY\.md$/i.test(f.sourcePath),
      ) ?? status.files.find((f) => f.kind === "auto_memory");
    const absPath =
      memoryFile?.sourcePath ??
      `${status.autoMemoryPath.replace(/[/\\]+$/, "")}/MEMORY.md`;
    return { ...target, displayPath: absPath, absolutePath: absPath };
  } catch {
    return target;
  }
}

/** 在偏好编辑器中打开补丁目标文件。 */
export async function openFeedbackConfigPatchFile(input: {
  repositoryPath?: string | null;
  patch: FeedbackConfigPatch;
}): Promise<void> {
  const target = await enrichFeedbackConfigPatchFileTarget(
    input.patch,
    input.repositoryPath,
  );
  const repo = input.repositoryPath?.trim();

  if (target.openKind === "repository_relative" && target.repositoryRelativePath && repo) {
    await openRepositoryEntryInPreferredEditor(repo, target.repositoryRelativePath);
    return;
  }
  if (target.openKind === "absolute" && target.absolutePath) {
    await openAbsolutePathInPreferredEditor(target.absolutePath);
    return;
  }
  if (target.openKind === "memory" && target.absolutePath) {
    await openAbsolutePathInPreferredEditor(target.absolutePath);
    return;
  }
  throw new Error(OPEN_WORKSPACE_ERROR.EMPTY_PATH);
}

export { mergeAppendSectionContent };
