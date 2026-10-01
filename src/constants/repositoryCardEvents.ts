import type { GitPanelRepositoryEntry } from "../utils/workspaceRepositoryTreeSelect";

export const WISE_REPOSITORY_CARD_ACTION = "wise:repository-card-action";
export type RepositoryCardActionDetail = {
  entry: GitPanelRepositoryEntry;
} & (
  | { action: "terminal" | "editor" | "session" | "files" }
  | { action: "configure-editor"; openAppId: string | null }
);

export function requestRepositoryCardAction(detail: RepositoryCardActionDetail): void {
  window.dispatchEvent(new CustomEvent<RepositoryCardActionDetail>(WISE_REPOSITORY_CARD_ACTION, { detail }));
}
