import { invoke } from "@tauri-apps/api/core";

/** 在种子仓库根目录执行 `trellis init -y`（若已存在祖先 `.trellis/scripts/task.py` 则跳过）。 */
export async function bootstrapTrellisIfMissing(repositoryPath: string): Promise<void> {
  return invoke<void>("bootstrap_trellis_if_missing", { repositoryPath });
}
