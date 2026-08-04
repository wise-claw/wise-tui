import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";

export interface WorkspaceFileTreeRailContext {
  repositoryPath: string;
  repositoryName: string;
  repositoryEntries?: GitPanelRepositoryEntry[];
  onOpenFile: (path: string, options?: GitPanelOpenFileOptions) => void;
}
