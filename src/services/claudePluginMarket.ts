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

export interface ClaudePluginAvailableEntry {
  pluginId: string;
  name: string;
  description?: string | null;
  marketplaceName: string;
  version?: string | null;
}

export interface ClaudePluginMarketplaceScanResult {
  marketplaceName: string;
  log: string;
  available: ClaudePluginAvailableEntry[];
}

export async function claudePluginMarketBootstrap(): Promise<ClaudePluginMarketBootstrapResult> {
  try {
    return await invoke<ClaudePluginMarketBootstrapResult>("claude_plugin_market_bootstrap");
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginListInstalled(
  repositoryPath?: string | null,
): Promise<ClaudePluginInstalledEntry[]> {
  try {
    const trimmed = repositoryPath?.trim();
    return await invoke<ClaudePluginInstalledEntry[]>("claude_plugin_list_installed", {
      repositoryPath: trimmed || null,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginInstall(
  installRef: string,
  scope: ClaudePluginInstallScope = "user",
  repositoryPath?: string | null,
): Promise<string> {
  try {
    const trimmed = repositoryPath?.trim();
    return await invoke<string>("claude_plugin_install", {
      installRef,
      scope,
      repositoryPath: trimmed || null,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginScanMarketplaceSource(
  source: string,
  scope: ClaudePluginInstallScope = "user",
  repositoryPath?: string | null,
): Promise<ClaudePluginMarketplaceScanResult> {
  try {
    const trimmed = repositoryPath?.trim();
    return await invoke<ClaudePluginMarketplaceScanResult>("claude_plugin_scan_marketplace_source", {
      source: source.trim(),
      scope,
      repositoryPath: trimmed || null,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function claudePluginUninstall(
  installRef: string,
  scope: ClaudePluginInstallScope = "user",
  repositoryPath?: string | null,
): Promise<string> {
  try {
    const trimmed = repositoryPath?.trim();
    return await invoke<string>("claude_plugin_uninstall", {
      installRef,
      scope,
      repositoryPath: trimmed || null,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}
