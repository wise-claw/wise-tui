/**
 * Legacy `~/.wise/prd-runs/` 读取与导入助手。
 *
 * 不做自动迁移；只暴露列表 + 单条读取，UI 决定怎么把 prd.md 喂给新向导。
 */

import { invoke } from "@tauri-apps/api/core";

export interface LegacyRunSummary {
  runId: string;
  runDir: string;
  createdAtMs: number;
  prdPreview: string;
  hasSplitResult: boolean;
  taskCount: number;
  repositoryId: number | null;
  repositoryName: string | null;
}

interface ListOutput {
  runs: LegacyRunSummary[];
}

export interface LegacyRunDetail {
  runId: string;
  runDir: string;
  prdMarkdown: string;
  splitResultRawJson: string | null;
  requirementsIndexJson: string | null;
  repoContextJson: string | null;
  metaJson: string | null;
}

export async function listLegacyRuns(): Promise<LegacyRunSummary[]> {
  const out = await invoke<ListOutput>("prd_split_list_legacy_runs");
  return out.runs;
}

export async function readLegacyRun(runId: string): Promise<LegacyRunDetail> {
  return invoke<LegacyRunDetail>("prd_split_read_legacy_run", { input: { runId } });
}
