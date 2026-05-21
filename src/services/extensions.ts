import { invoke } from "@tauri-apps/api/core";
import type {
  ExtensionListEntry,
  ExtensionPermissionsResponse,
  ResolvedMcpServer,
  ResolvedSettingsDeclaration,
  ResolvedSettingsTab,
  ResolvedSkill,
  ResolvedTheme,
} from "../types/extension";

export async function listExtensions(): Promise<ExtensionListEntry[]> {
  return invoke<ExtensionListEntry[]>("extensions_list");
}

export async function getExtensionSkills(): Promise<ResolvedSkill[]> {
  return invoke<ResolvedSkill[]>("extensions_get_skills");
}

export async function getExtensionThemes(): Promise<ResolvedTheme[]> {
  return invoke<ResolvedTheme[]>("extensions_get_themes");
}

export async function getExtensionSettingsDeclarations(): Promise<ResolvedSettingsDeclaration[]> {
  return invoke<ResolvedSettingsDeclaration[]>("extensions_get_settings_declarations");
}

export async function getExtensionMcpServers(): Promise<ResolvedMcpServer[]> {
  return invoke<ResolvedMcpServer[]>("extensions_get_mcp_servers");
}

export async function getExtensionSettingsTabs(): Promise<ResolvedSettingsTab[]> {
  return invoke<ResolvedSettingsTab[]>("extensions_get_settings_tabs");
}

export async function readExtensionSettingsTabBody(id: string): Promise<string> {
  return invoke<string>("extensions_read_settings_tab_body", { args: { id } });
}

export async function setExtensionEnabled(name: string, enabled: boolean): Promise<void> {
  await invoke<void>("extensions_set_enabled", { args: { name, enabled } });
}

export async function getExtensionPermissions(
  name: string,
): Promise<ExtensionPermissionsResponse | null> {
  return invoke<ExtensionPermissionsResponse | null>("extensions_get_permissions", {
    args: { name },
  });
}

export async function reloadExtensions(): Promise<ExtensionListEntry[]> {
  return invoke<ExtensionListEntry[]>("extensions_reload");
}

export interface InstallHelloWorldExtensionResult {
  destPath: string;
  entry: ExtensionListEntry;
}

export async function installHelloWorldExtension(): Promise<InstallHelloWorldExtensionResult> {
  return invoke<InstallHelloWorldExtensionResult>("extensions_install_hello_world_example");
}
