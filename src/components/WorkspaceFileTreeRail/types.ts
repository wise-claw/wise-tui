import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";

export interface WorkspaceFileTreeRailContext {
  repositoryPath: string;
  repositoryName: string;
  workspaceSelector: Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;
  onOpenFile: (path: string, options?: GitPanelOpenFileOptions) => void;
}
