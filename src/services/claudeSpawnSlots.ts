import { invoke } from "@tauri-apps/api/core";

/** 读取 Rust 侧 `spawn_slots_by_scope` 占用数；浏览器或非 Tauri 环境返回 `null`。 */
export async function getClaudeSpawnSlotCount(scopeKey: string): Promise<number | null> {
  const sk = scopeKey.trim();
  if (!sk) return null;
  try {
    const n = await invoke<number>("get_claude_spawn_slot_count", { scopeKey: sk });
    return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  } catch {
    return null;
  }
}
