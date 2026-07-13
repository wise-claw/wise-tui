/**
 * Detected agents are execution engines: local CLI binaries today, and
 * possibly remote endpoints later. Assistants are configuration presets that
 * reference an engine; keep detection and assistant configuration separate.
 */
export type DetectedAgentKind = "claude" | "codex" | "gemini" | "opencode" | "cursor" | "custom";

type SharedFields = {
  id: string;
  name: string;
  kind: DetectedAgentKind;
  available: boolean;
  backend: string;
  binaryPath?: string;
  detectedAt: string;
  failureReason?: string;
  installedVersion?: string;
};

type KindFields = {
  claude: { command: "claude" };
  codex: { command: "codex" };
  gemini: { command: "gemini" };
  opencode: { command: "opencode" };
  cursor: { command: "cursor-sdk" };
  custom: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
};

export type DetectedAgent<K extends DetectedAgentKind = DetectedAgentKind> =
  K extends DetectedAgentKind ? SharedFields & { kind: K } & KindFields[K] : never;

export interface CustomAgentInput {
  id?: string | null;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  resolvedPath?: string;
  version?: string;
}

/** 后端 `agent_registry_check_latest` / `agent_registry_check_updates` 的返回结构。 */
export interface LatestVersionInfo {
  kind: string;
  installed?: string;
  latest?: string;
  upgradable: boolean;
  manual: boolean;
  checkedAt: number;
}

export function isAgentKind<K extends DetectedAgentKind>(
  agent: DetectedAgent,
  kind: K,
): agent is DetectedAgent<K> {
  return agent.kind === kind;
}
