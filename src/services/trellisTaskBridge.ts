import { invoke } from "@tauri-apps/api/core";

export interface TrellisTaskSummary {
  taskId: string;
  dir: string;
  title: string;
  status: string;
  hasPrd: boolean;
  hasResearch: boolean;
  createdAt?: string;
  parent?: string;
}

export interface TrellisTaskDetail {
  taskId: string;
  dir: string;
  title: string;
  status: string;
  taskJsonRaw: string;
  prdMarkdown: string;
  researchFiles: string[];
}

export interface TrellisResearchFile {
  name: string;
  sizeBytes: number;
  modifiedAt?: number;
}

export async function listTrellisTasks(repoPath: string): Promise<TrellisTaskSummary[]> {
  return invoke<TrellisTaskSummary[]>("trellis_list_tasks", { repoPath });
}

export async function readTrellisTask(
  repoPath: string,
  taskId: string,
): Promise<TrellisTaskDetail> {
  return invoke<TrellisTaskDetail>("trellis_read_task", { repoPath, taskId });
}

export async function writeTrellisPrd(
  repoPath: string,
  taskId: string,
  content: string,
): Promise<void> {
  return invoke("trellis_write_prd", { repoPath, taskId, content });
}

export async function writeTrellisStatus(
  repoPath: string,
  taskId: string,
  status: string,
): Promise<void> {
  return invoke("trellis_write_status", { repoPath, taskId, status });
}

export async function listTrellisResearch(
  repoPath: string,
  taskId: string,
): Promise<TrellisResearchFile[]> {
  return invoke<TrellisResearchFile[]>("trellis_list_research", { repoPath, taskId });
}
