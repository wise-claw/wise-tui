import { invoke } from "@tauri-apps/api/core";

export async function loadRepoTaskSplitPromptSection(repositoryId: number): Promise<string | null> {
  try {
    return await invoke<string | null>("get_repo_task_split_prompt_section", { repositoryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("loadRepoTaskSplitPromptSection:", msg);
    return null;
  }
}

export async function saveRepoTaskSplitPromptSection(repositoryId: number, markdown: string): Promise<void> {
  await invoke("set_repo_task_split_prompt_section", { repositoryId, value: markdown });
}

export async function clearRepoTaskSplitPromptSection(repositoryId: number): Promise<void> {
  await invoke("clear_repo_task_split_prompt_section", { repositoryId });
}
