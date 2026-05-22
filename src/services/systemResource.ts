import { invoke } from "@tauri-apps/api/core";
import type { SystemResourceSnapshot } from "../types";

export async function getSystemResourceSnapshot(): Promise<SystemResourceSnapshot> {
  return invoke<SystemResourceSnapshot>("get_system_resource_snapshot");
}

/** 按 PID 结束本机 Claude 相关子进程（系统扫描条目、无 session id 时）。 */
export async function killClaudeHostProcess(pid: number): Promise<void> {
  return invoke("kill_claude_host_process", { pid });
}
