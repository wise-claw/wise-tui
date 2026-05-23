import { invoke } from "@tauri-apps/api/core";
import type { FccTraceEntry } from "../types/fccTrace";

export async function listFccTraces(options?: {
  sinceMs?: number;
  limit?: number;
  sessionHint?: string;
}): Promise<FccTraceEntry[]> {
  return invoke<FccTraceEntry[]>("list_fcc_traces", {
    sinceMs: options?.sinceMs ?? null,
    limit: options?.limit ?? 200,
    sessionHint: options?.sessionHint?.trim() || null,
  });
}

export async function clearFccTraces(): Promise<number> {
  return invoke<number>("clear_fcc_traces");
}
