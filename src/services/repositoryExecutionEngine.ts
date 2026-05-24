import { invoke } from "@tauri-apps/api/core";
import type { Repository, SessionExecutionEngine } from "../types";

export async function updateRepositoryExecutionEngine(
  id: number,
  executionEngine: SessionExecutionEngine,
): Promise<Repository> {
  return invoke<Repository>("update_repository_execution_engine", {
    id,
    executionEngine,
  });
}
