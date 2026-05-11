import { invoke } from "@tauri-apps/api/core";

/** 平台级「PRD 任务拆分」等提示词包（迁移写入 `app_settings`，与代码默认合并）。 */
export async function loadPlatformSplitPromptLayers(): Promise<string | null> {
  try {
    return await invoke<string | null>("get_platform_split_prompt_layers");
  } catch (err) {
    console.error("loadPlatformSplitPromptLayers:", err);
    return null;
  }
}

export async function loadProjectSplitPromptLayers(projectId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("get_project_split_prompt_layers", { projectId });
  } catch (err) {
    console.error("loadProjectSplitPromptLayers:", err);
    return null;
  }
}

export async function saveProjectSplitPromptLayers(projectId: string, json: string): Promise<void> {
  await invoke("set_project_split_prompt_layers", { projectId, value: json });
}

export async function clearProjectSplitPromptLayers(projectId: string): Promise<void> {
  await invoke("clear_project_split_prompt_layers", { projectId });
}

export async function loadRepositorySplitPromptLayers(repositoryId: number): Promise<string | null> {
  try {
    return await invoke<string | null>("get_repository_split_prompt_layers", { repositoryId });
  } catch (err) {
    console.error("loadRepositorySplitPromptLayers:", err);
    return null;
  }
}

export async function saveRepositorySplitPromptLayers(repositoryId: number, json: string): Promise<void> {
  await invoke("set_repository_split_prompt_layers", { repositoryId, value: json });
}

export async function clearRepositorySplitPromptLayers(repositoryId: number): Promise<void> {
  await invoke("clear_repository_split_prompt_layers", { repositoryId });
}
