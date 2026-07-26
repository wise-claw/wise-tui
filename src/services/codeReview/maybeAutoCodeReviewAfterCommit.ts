import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { openCodeReviewDrawer } from "../../constants/workflowUiEvents";
import { loadCodeReviewSettings } from "./codeReviewSettings";

/**
 * After a successful local commit, optionally open Code Review against the branch scope
 * (uncommitted is empty post-commit; branch reviews the just-landed commits vs trunk).
 */
export async function maybeAutoCodeReviewAfterCommit(input: {
  repositoryPath: string;
  repositoryName?: string;
  executionEngine?: SessionExecutionEngine | string | null;
}): Promise<boolean> {
  const repositoryPath = input.repositoryPath.trim();
  if (!repositoryPath) return false;

  try {
    const settings = await loadCodeReviewSettings();
    if (!settings.autoReviewAfterCommit) return false;
  } catch {
    return false;
  }

  openCodeReviewDrawer({
    repositoryPath,
    repositoryName: input.repositoryName,
    executionEngine: input.executionEngine,
    autoStart: true,
    initialScope: "branch",
  });
  return true;
}
