import type { GitPanelOpenFileOptions } from "../GitPanel/types";

export interface WorkspaceFileTreeRailContext {
  repositoryPath: string;
  repositoryName: string;
  onOpenFile: (path: string, options?: GitPanelOpenFileOptions) => void;
}
