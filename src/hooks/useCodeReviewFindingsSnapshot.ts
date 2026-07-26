import { useSyncExternalStore } from "react";
import {
  getCodeReviewFindingsSnapshot,
  subscribeCodeReviewFindings,
  type CodeReviewFindingsSnapshot,
} from "../stores/codeReviewFindingsStore";

function subscribe(listener: () => void): () => void {
  return subscribeCodeReviewFindings(listener);
}

/**
 * Subscribe to the latest published Code Review findings for a repository.
 */
export function useCodeReviewFindingsSnapshot(
  repositoryPath: string | null | undefined,
): CodeReviewFindingsSnapshot | null {
  const repo = repositoryPath?.trim() ?? "";
  return useSyncExternalStore(
    subscribe,
    () => (repo ? getCodeReviewFindingsSnapshot(repo) : null),
    () => null,
  );
}
