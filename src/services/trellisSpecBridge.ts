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

export async function listTrellisSpecAreas(repoPath: string): Promise<TrellisSpecArea[]> {
  return invoke<TrellisSpecArea[]>("trellis_list_spec_areas", { repoPath });
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
