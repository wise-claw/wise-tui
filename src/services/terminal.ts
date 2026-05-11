import { invoke } from "@tauri-apps/api/core";

export interface ShellCommandResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function runShellCommand(
  path: string,
  command: string,
): Promise<ShellCommandResponse> {
  return invoke<ShellCommandResponse>("run_shell_command", { path, command });
}

// ── PTY Terminal Session ──

export async function openTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
  cwd: string,
): Promise<void> {
  return invoke("terminal_open", { workspaceId, terminalId, cols, rows, cwd });
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

export async function closeTerminalSession(
  workspaceId: string,
  terminalId: string,
): Promise<void> {
  return invoke("terminal_close", { workspaceId, terminalId });
}
