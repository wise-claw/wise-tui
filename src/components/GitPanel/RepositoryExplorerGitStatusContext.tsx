import { createContext, useContext, type ReactNode } from "react";

export interface RepositoryExplorerGitStatusValue {
  generation: number;
  editorDirtyRevision: number;
  getFileStatus: (path: string) => string | null;
  getDirStatus: (path: string) => string | null;
  dirHasChanges: (path: string) => boolean;
  isEditorDirty: (path: string) => boolean;
}

const RepositoryExplorerGitStatusContext = createContext<RepositoryExplorerGitStatusValue | null>(
  null,
);

export function RepositoryExplorerGitStatusProvider({
  value,
  children,
}: {
  value: RepositoryExplorerGitStatusValue;
  children: ReactNode;
}) {
  return (
    <RepositoryExplorerGitStatusContext.Provider value={value}>
      {children}
    </RepositoryExplorerGitStatusContext.Provider>
  );
}

export function useRepositoryExplorerGitStatus(): RepositoryExplorerGitStatusValue {
  const ctx = useContext(RepositoryExplorerGitStatusContext);
  if (!ctx) {
    return {
      generation: 0,
      editorDirtyRevision: 0,
      getFileStatus: () => null,
      getDirStatus: () => null,
      dirHasChanges: () => false,
      isEditorDirty: () => false,
    };
  }
  return ctx;
}
