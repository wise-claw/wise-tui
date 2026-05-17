import { invoke } from "@tauri-apps/api/core";

export interface ActivePrdRunRow {
  runId: string;
  clusterId: string;
  runDir: string;
  startedAtMs: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  hasRunResult: boolean;
  projectRootPath: string;
  missionId: string | null;
  parentTaskPath: string | null;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  error: string | null;
}

export async function listActivePrdRuns(): Promise<ActivePrdRunRow[]> {
  return invoke<ActivePrdRunRow[]>("prd_split_list_active_runs");
}
