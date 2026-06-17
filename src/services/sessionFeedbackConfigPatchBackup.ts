import { appendWiseRelativeFile } from "./materializePrdSnapshot";
import {
  feedbackConfigPatchBackupRelativePath,
  type FeedbackPatchBackupRecord,
} from "../utils/sessionFeedbackConfigPatchJson";
import type { FeedbackConfigPatch } from "../utils/sessionFeedbackConfigPatch";

export type { FeedbackPatchBackupRecord };
export { feedbackConfigPatchBackupRelativePath };

const BACKUP_MAX_CHARS = 48_000;

function truncateForBackup(text: string | null | undefined): string | null {
  if (text == null) return null;
  if (text.length <= BACKUP_MAX_CHARS) return text;
  return `${text.slice(0, BACKUP_MAX_CHARS)}\n…[truncated]`;
}

/** 应用前将补丁写入 ~/.wise/feedback-patches/<repo-hash>/applies.jsonl。 */
export async function backupFeedbackConfigPatchApply(input: {
  repositoryPath: string;
  patch: FeedbackConfigPatch;
  before: string | null;
  after: string;
  mcpWasEnabled?: boolean;
}): Promise<void> {
  const repo = input.repositoryPath.trim();
  if (!repo) return;

  const at = Date.now();
  const relativePath = feedbackConfigPatchBackupRelativePath(repo);
  const payload: FeedbackPatchBackupRecord = {
    backupId: `${at}-${input.patch.id}`,
    at,
    repositoryPath: repo,
    patchId: input.patch.id,
    kind: input.patch.kind,
    action: input.patch.action,
    path: input.patch.path,
    rationale: input.patch.rationale.slice(0, 500),
    before: truncateForBackup(input.before),
    after: truncateForBackup(input.after),
    mcp: input.patch.mcp,
    mcpWasEnabled: input.mcpWasEnabled,
  };

  try {
    await appendWiseRelativeFile(relativePath, `${JSON.stringify(payload)}\n`);
  } catch {
    /* 备份失败不阻断落盘 */
  }
}
