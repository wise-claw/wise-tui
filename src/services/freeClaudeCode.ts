import { invoke } from "@tauri-apps/api/core";

/** jiaolong1021/free-claude-code 集成状态。 */
export interface FreeClaudeCodeStatus {
  uvReady: boolean;
  claudeCliReady: boolean;
  installed: boolean;
  serverRunning: boolean;
  managedByWise: boolean;
  port: number;
  authToken: string | null;
  model: string | null;
  adminUrl: string;
  proxyBaseUrl: string;
  binaryPath: string | null;
  repoUrl: string;
  configPath: string;
  claudeSettingsAligned: boolean;
}

export const FREE_CLAUDE_CODE_REPO_URL =
  "https://github.com/jiaolong1021/free-claude-code";

export const FREE_CLAUDE_CODE_QUICK_START_URL =
  "https://github.com/jiaolong1021/free-claude-code#quick-start";

export async function getFreeClaudeCodeStatus(): Promise<FreeClaudeCodeStatus> {
  return invoke<FreeClaudeCodeStatus>("get_free_claude_code_status");
}

export async function startFreeClaudeCodeServer(): Promise<FreeClaudeCodeStatus> {
  return invoke<FreeClaudeCodeStatus>("start_free_claude_code_server");
}

export async function stopFreeClaudeCodeServer(): Promise<FreeClaudeCodeStatus> {
  return invoke<FreeClaudeCodeStatus>("stop_free_claude_code_server");
}

export async function installFreeClaudeCode(): Promise<string> {
  return invoke<string>("install_free_claude_code");
}

export async function uninstallFreeClaudeCode(): Promise<FreeClaudeCodeStatus> {
  return invoke<FreeClaudeCodeStatus>("uninstall_free_claude_code");
}

export async function openFreeClaudeCodeAdmin(): Promise<void> {
  return invoke<void>("open_free_claude_code_admin");
}

export async function applyFreeClaudeCodeClaudeSettings(): Promise<boolean> {
  return invoke<boolean>("apply_free_claude_code_claude_settings");
}

export async function sanitizeClaudeCredentialsForFcc(): Promise<boolean> {
  return invoke<boolean>("sanitize_claude_credentials_for_fcc");
}
