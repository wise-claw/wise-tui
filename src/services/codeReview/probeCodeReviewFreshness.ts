import type { CodeReviewScope } from "../../types/codeReview";
import {
  clearCodeReviewFindings,
  getCodeReviewFindingsSnapshot,
  syncCodeReviewFindingsFreshness,
} from "../../stores/codeReviewFindingsStore";
import { collectCodeReviewDiff } from "./codeReviewIpc";
import { loadCodeReviewSettings } from "./codeReviewSettings";
import { fingerprintCodeReviewDiff } from "./diffFingerprint";

async function applyStalePolicy(repositoryPath: string, stale: boolean): Promise<void> {
  if (!stale) return;
  try {
    const settings = await loadCodeReviewSettings();
    if (settings.staleFindingsPolicy === "clear") {
      clearCodeReviewFindings(repositoryPath);
    }
  } catch {
    /* 读取设置失败时保留标注 */
  }
}

/**
 * Compare the live reviewable diff fingerprint against the published run.
 * Updates the findings store `stale` flag. Returns stale state, or null on skip/error.
 */
export async function probeCodeReviewFindingsFreshness(input: {
  repositoryPath: string;
  scope?: CodeReviewScope;
}): Promise<boolean | null> {
  const repositoryPath = input.repositoryPath.trim();
  if (!repositoryPath) return null;

  const snap = getCodeReviewFindingsSnapshot(repositoryPath);
  if (!snap?.run.diffFingerprint) return null;

  const scope: CodeReviewScope =
    input.scope ?? (snap.run.scope === "branch" ? "branch" : "uncommitted");

  try {
    const diff = await collectCodeReviewDiff({
      repositoryPath,
      scope,
      baseRef: snap.run.baseRef,
    });
    if (diff.empty) {
      syncCodeReviewFindingsFreshness(repositoryPath, "");
      await applyStalePolicy(repositoryPath, true);
      return true;
    }
    const fingerprint = fingerprintCodeReviewDiff({
      scope: String(diff.scope),
      baseRef: diff.baseRef,
      filePaths: diff.filePaths,
      diffText: diff.diffText,
    });
    syncCodeReviewFindingsFreshness(repositoryPath, fingerprint);
    const stale = getCodeReviewFindingsSnapshot(repositoryPath)?.stale ?? null;
    if (stale) {
      await applyStalePolicy(repositoryPath, true);
    }
    return stale;
  } catch {
    return null;
  }
}
