import { invoke } from "@tauri-apps/api/core";

export interface TrellisSpecArea {
  area: string;
  hasIndex: boolean;
  mdFileCount: number;
}

export interface TrellisSpecIndex {
  area: string;
  content: string;
  sizeBytes: number;
}

export interface TrellisSpecFile {
  relativePath: string;
  content: string;
  sizeBytes: number;
}

export interface TrellisSpecTreeNode {
  name: string;
  relativePath: string;
  nodeType: "directory" | "file";
  sizeBytes?: number | null;
  modifiedAt?: number | null;
  children: TrellisSpecTreeNode[];
}

export async function listTrellisSpecAreas(repoPath: string): Promise<TrellisSpecArea[]> {
  return invoke<TrellisSpecArea[]>("trellis_list_spec_areas", { repoPath });
}

export async function listTrellisSpecTree(repoPath: string): Promise<TrellisSpecTreeNode[]> {
  return invoke<TrellisSpecTreeNode[]>("trellis_list_spec_tree", { repoPath });
}

export async function readTrellisSpecIndex(
  repoPath: string,
  area: string,
): Promise<TrellisSpecIndex> {
  return invoke<TrellisSpecIndex>("trellis_read_spec_index", { repoPath, area });
}

export async function writeTrellisSpecIndex(
  repoPath: string,
  area: string,
  content: string,
): Promise<void> {
  return invoke("trellis_write_spec_index", { repoPath, area, content });
}

export async function readTrellisSpecFile(
  repoPath: string,
  relativePath: string,
): Promise<TrellisSpecFile> {
  return invoke<TrellisSpecFile>("trellis_read_spec_file", { repoPath, relativePath });
}

export async function writeTrellisSpecFile(
  repoPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  return invoke("trellis_write_spec_file", { repoPath, relativePath, content });
}
