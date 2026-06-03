import { createContext, useContext, type ReactNode } from "react";
import type { GitPanelOpenFileOptions } from "./types";
import type { ExplorerInlineCreateState } from "./types";

export interface RepositoryExplorerTreeActions {
  onToggleDir: (dirPath: string) => void;
  onSelectNode: (path: string, isDir: boolean) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onInlineValueChange: (value: string) => void;
  onInlineCommit: () => void;
  onInlineCancel: () => void;
}

const RepositoryExplorerTreeActionsContext = createContext<RepositoryExplorerTreeActions | null>(
  null,
);

export function RepositoryExplorerTreeActionsProvider({
  value,
  children,
}: {
  value: RepositoryExplorerTreeActions;
  children: ReactNode;
}) {
  return (
    <RepositoryExplorerTreeActionsContext.Provider value={value}>
      {children}
    </RepositoryExplorerTreeActionsContext.Provider>
  );
}

export function useRepositoryExplorerTreeActions(): RepositoryExplorerTreeActions {
  const ctx = useContext(RepositoryExplorerTreeActionsContext);
  if (!ctx) {
    throw new Error("useRepositoryExplorerTreeActions must be used within RepositoryExplorerTreeActionsProvider");
  }
  return ctx;
}

/** Optional inline-create snapshot passed only when a row needs it. */
export type RepositoryExplorerInlineCreateSnapshot = ExplorerInlineCreateState | null;
