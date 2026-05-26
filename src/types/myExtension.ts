export type MyExtensionInstallScope = "global" | "repository";

export type MyExtensionKind =
  | "package"
  | "mcp"
  | "skill"
  | "plugin"
  | "hook"
  | "script";

export interface ExtensionLibraryItem {
  id: string;
  kind: MyExtensionKind;
  name: string;
  description: string | null;
  capturedFromRepository: string | null;
  capturedAt: string;
  originScope: string | null;
  snapshotDir: string;
}

export interface DiscoverCandidate {
  candidateId: string;
  kind: MyExtensionKind;
  name: string;
  description: string | null;
  sourcePath: string;
  originScope: string;
  alreadyInLibrary: boolean;
}

export interface InstallFromLibraryResult {
  installedPath: string;
  installScope: MyExtensionInstallScope;
}

export interface SnapshotTreeNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children?: SnapshotTreeNode[];
}

export interface ExtensionLibraryContent {
  libraryItemId: string;
  relativePath: string;
  path: string;
  language: string;
  content: string;
}
