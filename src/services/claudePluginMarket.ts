import { invoke } from "@tauri-apps/api/core";

export interface ClaudePluginInstalledEntry {
  id: string;
  version?: string | null;
  scope: string;
  enabled: boolean;
}

export interface ClaudePluginMarketBootstrapResult {
  ok: boolean;
  log: string;
}

export type ClaudePluginInstallScope = "user" | "project" | "local";

export async function claudePluginMarketBootstrap(): Promise<ClaudePluginMarketBootstrapResult> {
  try {
    return await invoke<ClaudePluginMarketBootstrapResult>("claude_plugin_market_bootstrap");
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginListInstalled(): Promise<ClaudePluginInstalledEntry[]> {
  try {
    return await invoke<ClaudePluginInstalledEntry[]>("claude_plugin_list_installed");
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginInstall(
  installRef: string,
  scope: ClaudePluginInstallScope = "user",
): Promise<string> {
  try {
    return await invoke<string>("claude_plugin_install", { installRef, scope });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginUninstall(
  installRef: string,
  scope: ClaudePluginInstallScope = "user",
): Promise<string> {
  try {
    return await invoke<string>("claude_plugin_uninstall", { installRef, scope });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}
