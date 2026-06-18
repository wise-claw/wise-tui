import { readWiseRelativeFile } from "./projectRelativeFiles";
import {
  feedbackConfigPatchBackupRelativePath,
  parseFeedbackPatchBackupJsonl,
  type FeedbackPatchBackupRecord,
} from "../utils/sessionFeedbackConfigPatchJson";

export type { FeedbackPatchBackupRecord };

export { feedbackConfigPatchBackupRelativePath };

/** 读取仓库的补丁备份记录（最新在前）。 */
export async function listFeedbackConfigPatchBackups(
  repositoryPath: string,
  limit = 20,
): Promise<FeedbackPatchBackupRecord[]> {
  const repo = repositoryPath.trim();
  if (!repo) return [];
  const relativePath = feedbackConfigPatchBackupRelativePath(repo);
  try {
    const raw = await readWiseRelativeFile(relativePath);
    return parseFeedbackPatchBackupJsonl(raw).slice(0, limit);
  } catch {
    return [];
  }
}
