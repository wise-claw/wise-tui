import { invoke } from "@tauri-apps/api/core";
import type { AssistantEntry, CustomAssistantInput } from "../types/assistant";

export async function listAssistants(): Promise<AssistantEntry[]> {
  return invoke<AssistantEntry[]>("assistants_list");
}

export async function saveCustomAssistant(input: CustomAssistantInput): Promise<AssistantEntry> {
  return invoke<AssistantEntry>("assistants_save_custom", { args: { input } });
}

export async function deleteCustomAssistant(customId: string): Promise<void> {
  await invoke<void>("assistants_delete_custom", { args: { customId } });
}

export async function getAssistantSystemPrompt(id: string): Promise<string> {
  return invoke<string>("assistants_get_system_prompt", { args: { id } });
}
