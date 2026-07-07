import { invoke } from "@tauri-apps/api/core";
import type {
  TerminalAttachResponse,
  TerminalSessionInfo,
  TerminalSessionSource,
} from "../types/terminal";

export interface ShellCommandResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface SpawnShellCommandResponse {
  /** 后台子进程的 pid，仅用于日志/排障，不要据此判断脚本是否完成。 */
  pid: number;
}

export async function runShellCommand(
  path: string,
  command: string,
): Promise<ShellCommandResponse> {
  return invoke<ShellCommandResponse>("run_shell_command", { path, command });
}

/**
 * 后台通过 shell 启动执行命令（fire-and-forget）。
 * 不会等子进程结束，也不接管 stdout/stderr；适合 dev server / watcher 等
 * 长期任务。调用方拿到的 `pid` 仅用于日志/排障，不要据此判断脚本是否完成。
 */
export async function spawnShellCommand(
  path: string,
  command: string,
): Promise<SpawnShellCommandResponse> {
  return invoke<SpawnShellCommandResponse>("spawn_shell_command", { path, command });
}

// ── PTY Terminal Session ──

export async function openTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
  cwd: string,
  options?: {
    title?: string;
    source?: TerminalSessionSource;
  },
): Promise<void> {
  return invoke("terminal_open", {
    workspaceId,
    terminalId,
    cols,
    rows,
    cwd,
    title: options?.title,
    source: options?.source ?? "user",
  });
}

export async function attachTerminalSession(
  workspaceId: string,
  terminalId: string,
  cursor: number,
): Promise<TerminalAttachResponse> {
  return invoke<TerminalAttachResponse>("terminal_attach", {
    workspaceId,
    terminalId,
    cursor,
  });
}

export async function listTerminalSessions(
  workspaceId: string,
): Promise<TerminalSessionInfo[]> {
  return invoke<TerminalSessionInfo[]>("terminal_list", { workspaceId });
}

export async function getTerminalSession(
  workspaceId: string,
  terminalId: string,
): Promise<TerminalSessionInfo | null> {
  return invoke<TerminalSessionInfo | null>("terminal_get", {
    workspaceId,
    terminalId,
  });
}

export async function updateTerminalSessionTitle(
  workspaceId: string,
  terminalId: string,
  title: string,
): Promise<void> {
  return invoke("terminal_update_title", { workspaceId, terminalId, title });
}

export async function writeTerminalSession(
  workspaceId: string,
  terminalId: string,
  data: string,
): Promise<void> {
  return invoke("terminal_write", { workspaceId, terminalId, data });
}

export async function resizeTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { workspaceId, terminalId, cols, rows });
}

export async function openAgentTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
  cwd: string,
  title?: string,
): Promise<void> {
  return openTerminalSession(workspaceId, terminalId, cols, rows, cwd, {
    title: title ?? "Agent 终端",
    source: "agent",
  });
}

export async function closeTerminalSession(
  workspaceId: string,
  terminalId: string,
): Promise<void> {
  return invoke("terminal_close", { workspaceId, terminalId });
}
