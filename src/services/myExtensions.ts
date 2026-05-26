import { invoke } from "@tauri-apps/api/core";
import {
  notifyExtensionLibraryChanged,
  type ExtensionLibraryChangedDetail,
} from "../constants/extensionLibraryUiEvents";
import type {
  DiscoverCandidate,
  ExtensionLibraryContent,
  ExtensionLibraryItem,
  InstallFromLibraryResult,
  MyExtensionInstallScope,
  MyExtensionKind,
  SnapshotTreeNode,
} from "../types/myExtension";
import type { InstallHelloWorldExtensionResult } from "./extensions";

export interface InstallTargetArgs {
  installScope: MyExtensionInstallScope;
  repositoryPath?: string | null;
}

function targetArgs(args: InstallTargetArgs): Record<string, unknown> {
  const repo = args.repositoryPath?.trim();
  return {
    args: {
      installScope: args.installScope,
      repositoryPath: repo && repo.length > 0 ? repo : null,
    },
  };
}

export async function listExtensionLibrary(): Promise<ExtensionLibraryItem[]> {
  return invoke<ExtensionLibraryItem[]>("my_extensions_library_list");
}

export async function removeExtensionLibraryItem(libraryItemId: string): Promise<void> {
  await invoke<void>("my_extensions_library_remove", {
    args: { libraryItemId },
  });
  notifyExtensionLibraryChanged();
}

export async function getExtensionLibraryHome(): Promise<string> {
  return invoke<string>("my_extensions_library_home");
}

export async function updateExtensionLibraryItemName(
  libraryItemId: string,
  name: string,
): Promise<ExtensionLibraryItem> {
  return invoke<ExtensionLibraryItem>("my_extensions_library_update_name", {
    args: { libraryItemId, name },
  });
}

export async function listExtensionLibrarySnapshotTree(
  libraryItemId: string,
): Promise<SnapshotTreeNode[]> {
  return invoke<SnapshotTreeNode[]>("my_extensions_library_list_snapshot_tree", {
    args: { libraryItemId },
  });
}

export async function getExtensionLibraryItemContent(
  libraryItemId: string,
  relativePath?: string | null,
): Promise<ExtensionLibraryContent> {
  return invoke<ExtensionLibraryContent>("my_extensions_library_get_content", {
    args: { libraryItemId, relativePath: relativePath ?? null },
  });
}

export async function saveExtensionLibraryItemContent(
  libraryItemId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await invoke<void>("my_extensions_library_save_content", {
    args: { libraryItemId, relativePath, content },
  });
}

export async function createExtensionLibrarySnapshotFile(
  libraryItemId: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("my_extensions_library_create_snapshot_file", {
    args: { libraryItemId, relativePath },
  });
}

export async function createExtensionLibrarySnapshotDirectory(
  libraryItemId: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("my_extensions_library_create_snapshot_directory", {
    args: { libraryItemId, relativePath },
  });
}

export async function deleteExtensionLibrarySnapshotEntry(
  libraryItemId: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("my_extensions_library_delete_snapshot_entry", {
    args: { libraryItemId, relativePath },
  });
}

export async function discoverRepositoryExtensions(
  repositoryPath: string,
): Promise<DiscoverCandidate[]> {
  return invoke<DiscoverCandidate[]>("my_extensions_discover", {
    args: { repositoryPath },
  });
}

export const MCP_MULTI_SERVERS_PREFIX = "MCP_MULTI_SERVERS:";

export interface CaptureExtensionFromPathArgs {
  repositoryPath: string;
  relativePath: string;
  kind: MyExtensionKind;
  name?: string | null;
}

export async function captureExtensionFromRepositoryPath(
  args: CaptureExtensionFromPathArgs,
): Promise<ExtensionLibraryItem> {
  const repo = args.repositoryPath.trim();
  const rel = args.relativePath.trim();
  const item = await invoke<ExtensionLibraryItem>("my_extensions_capture_from_path", {
    args: {
      repositoryPath: repo,
      relativePath: rel,
      kind: args.kind,
      name: args.name?.trim() || null,
    },
  });
  notifyExtensionLibraryChanged({ selectedItemId: item.id });
  return item;
}

export async function captureRepositoryExtension(
  repositoryPath: string,
  candidateId: string,
): Promise<ExtensionLibraryItem> {
  const item = await invoke<ExtensionLibraryItem>("my_extensions_capture", {
    args: { repositoryPath, candidateId },
  });
  notifyExtensionLibraryChanged({ selectedItemId: item.id });
  return item;
}

export async function captureAllRepositoryExtensions(
  repositoryPath: string,
): Promise<ExtensionLibraryItem[]> {
  const items = await invoke<ExtensionLibraryItem[]>("my_extensions_capture_all", {
    args: { repositoryPath },
  });
  const last = items[items.length - 1];
  notifyExtensionLibraryChanged(
    last ? { selectedItemId: last.id } : undefined,
  );
  return items;
}

export async function installExtensionFromLibrary(
  libraryItemId: string,
  target: InstallTargetArgs,
): Promise<InstallFromLibraryResult> {
  const repo = target.repositoryPath?.trim();
  return invoke<InstallFromLibraryResult>("my_extensions_install_from_library", {
    args: {
      libraryItemId,
      installScope: target.installScope,
      repositoryPath: repo && repo.length > 0 ? repo : null,
    },
  });
}

export async function installHelloWorldMyExtension(
  target: InstallTargetArgs,
): Promise<InstallHelloWorldExtensionResult> {
  return invoke<InstallHelloWorldExtensionResult>(
    "my_extensions_install_hello_world",
    targetArgs(target),
  );
}

export async function syncRepositoryExtensionScan(
  repositoryPath: string | null | undefined,
): Promise<void> {
  const repo = repositoryPath?.trim();
  await invoke<void>("my_extensions_sync_repository_scan", {
    args: { repositoryPath: repo && repo.length > 0 ? repo : null },
  });
}
