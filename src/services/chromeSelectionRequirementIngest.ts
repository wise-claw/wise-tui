import { dispatchRequirementToExecutionEnvironment } from "../constants/pendingTaskQueueEvents";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "./mainWindow";
import {
  buildRequirementDispatchPayload,
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "./workspaceRequirementDispatch";
import {
  appendWorkspaceRequirement,
  updateWorkspaceRequirement,
} from "./workspaceRequirementsStore";
import type { Repository } from "../types";
import {
  createWorkspaceRequirementItem,
  deriveRequirementTitle,
} from "../types/workspaceRequirements";
import { openWorkspaceMemoPanel } from "../stores/workspaceMemoPanelStore";
import {
  buildChromeSelectionRequirementMarkdown,
  chromeSelectionHasContent,
  normalizeChromeSelectionRequirementEvent,
} from "../utils/chromeSelectionRequirement";

function resolveDefaultRepositoryId(
  activeRepositoryId: number | null,
  repositories: Repository[],
): string | null {
  if (activeRepositoryId != null) {
    const match = repositories.find((repo) => repo.id === activeRepositoryId);
    if (match) return String(match.id);
  }
  return repositories[0] != null ? String(repositories[0].id) : null;
}

export type ChromeSelectionIngestResult =
  | "ingested"
  | "ingested-undispatched"
  | "ignored"
  | "empty"
  | "no-repo";

export async function ingestChromeSelectionRequirement(
  raw: unknown,
  input: {
    repositories: Repository[];
    activeRepositoryId: number | null;
  },
): Promise<ChromeSelectionIngestResult> {
  if (!isCurrentPrimaryMainWorkspaceWindowSync()) return "ignored";
  const event = normalizeChromeSelectionRequirementEvent(raw);
  if (!chromeSelectionHasContent(event)) return "empty";
  const repositoryId = resolveDefaultRepositoryId(
    input.activeRepositoryId,
    input.repositories,
  );
  if (!repositoryId) return "no-repo";

  const markdown = buildChromeSelectionRequirementMarkdown(event);
  const materialized = await materializeRequirementBodyImages(markdown);
  if (!stripMarkdownImages(materialized.bodyMarkdown) && materialized.imagePaths.length === 0) {
    return "empty";
  }

  const now = Date.now();
  const created = createWorkspaceRequirementItem(materialized.bodyMarkdown, now, repositoryId);
  created.title = deriveRequirementTitle(materialized.bodyMarkdown);
  created.imagePaths = materialized.imagePaths;
  const saved = await appendWorkspaceRequirement(created);
  const savedItem = saved.items.find((row) => row.id === created.id);
  openWorkspaceMemoPanel(created.id);
  if (!savedItem) return "ingested-undispatched";

  const payload = await buildRequirementDispatchPayload(savedItem);
  const accepted = dispatchRequirementToExecutionEnvironment({
    promptText: payload.promptText,
    userBubblePrompt: payload.executeBubbleOptions?.userBubblePrompt ?? payload.promptText,
    source: "workspace-requirement",
    requirementId: savedItem.id,
    requirementRepositoryId: savedItem.repositoryId,
  });
  if (!accepted) return "ingested-undispatched";
  await updateWorkspaceRequirement(savedItem.id, (row) => ({
    ...row,
    lastDispatchedAt: now,
    dispatchAttemptCount: (row.dispatchAttemptCount ?? 0) + 1,
  }));
  return "ingested";
}
