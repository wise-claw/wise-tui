import { invoke } from "@tauri-apps/api/core";
import type { CodeReviewDiffPayload, CodeReviewRun, CodeReviewScope } from "../../types/codeReview";

export async function collectCodeReviewDiff(input: {
  repositoryPath: string;
  scope: CodeReviewScope;
  baseRef?: string | null;
}): Promise<CodeReviewDiffPayload> {
  return invoke<CodeReviewDiffPayload>("code_review_collect_diff", {
    args: {
      repositoryPath: input.repositoryPath,
      scope: input.scope,
      baseRef: input.baseRef?.trim() ? input.baseRef.trim() : null,
    },
  });
}

export async function saveCodeReviewRun(run: CodeReviewRun): Promise<CodeReviewRun> {
  return invoke<CodeReviewRun>("code_review_save_run", {
    args: { run },
  });
}

export async function listCodeReviewRuns(
  repositoryPath: string,
  limit = 20,
): Promise<CodeReviewRun[]> {
  return invoke<CodeReviewRun[]>("code_review_list_runs", {
    args: { repositoryPath, limit },
  });
}
