import { invoke } from "@tauri-apps/api/core";

/** 在所选目录无 `.openspec/` 时运行非交互 `openspec init`。 */
export async function bootstrapOpenspecIfMissing(repositoryPath: string): Promise<void> {
  return invoke<void>("bootstrap_openspec_if_missing", { repositoryPath });
}
