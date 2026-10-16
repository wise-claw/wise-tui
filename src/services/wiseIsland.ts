import { invoke } from "@tauri-apps/api/core";
import type { HudCompletionToastItem } from "../utils/hudCompletionToast";

export async function wiseIslandNotifyCompletion(items: readonly HudCompletionToastItem[]): Promise<void> {
  await invoke("wise_island_notify_completion", { items });
}

export async function wiseIslandOpenSession(sessionId: string): Promise<void> {
  await invoke("wise_island_open_session", { sessionId });
}
