export interface SkillContribution {
  name: string;
  description: string;
  file: string;
}

export interface ThemeContribution {
  id: string;
  name: string;
  file: string;
}

export interface SettingsDeclarationContribution {
  id: string;
  label: string;
  description?: string;
  kind: string;
}

export interface ExtensionListEntry {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  installed: boolean;
  error: string | null;
  lastActivation: string | null;
}

export interface ResolvedSkill {
  id: string;
  extension: string;
  name: string;
  description: string;
  location: string;
}

export interface ResolvedTheme {
  id: string;
  extension: string;
  name: string;
  location: string;
}

export interface ResolvedSettingsDeclaration {
  id: string;
  extension: string;
  label: string;
  description: string | null;
  kind: string;
}

export type McpTransportType = "stdio" | "sse" | "http" | "streamable_http";

export interface ResolvedMcpServer {
  id: string;
  extension: string;
  name: string;
  description: string | null;
  transport: {
    type: McpTransportType;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  defaultEnabled: boolean;
}

export type SettingsTabPlacement = "before" | "after";

export interface ResolvedSettingsTab {
  id: string;
  extension: string;
  label: string;
  /** Absolute filesystem path to the body markdown. */
  bodyPath: string;
  icon: string | null;
  anchor: string | null;
  placement: SettingsTabPlacement | null;
}

export interface ExtensionPermissions {
  storage: boolean;
  network: boolean;
  shell: boolean;
  filesystem: string | null;
  clipboard: boolean;
}

export interface ExtensionPermissionsResponse {
  permissions: ExtensionPermissions;
}
