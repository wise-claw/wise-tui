import { invoke } from "@tauri-apps/api/core";

/** Whether `.trellis/scripts/task.py` exists at this directory (ancestors are not checked). */
export async function trellisTaskPyExistsAtPath(path: string): Promise<boolean> {
  return invoke<boolean>("trellis_task_py_exists_at_path", { path });
}

/** Run non-interactive `trellis init` at `repositoryPath` when that directory has no `.trellis/scripts/task.py`. */
export async function bootstrapTrellisIfMissing(repositoryPath: string): Promise<void> {
  return invoke<void>("bootstrap_trellis_if_missing", { repositoryPath });
}
