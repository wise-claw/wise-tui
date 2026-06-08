import { invoke } from "@tauri-apps/api/core";
import { publishAgentRegistry } from "../stores/agentRegistryStore";
import type {
  CustomAgentInput,
  DetectedAgent,
  DetectedAgentKind,
  ProbeResult,
} from "../types/detectedAgent";

export async function listAgents(): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_list");
  publishAgentRegistry(agents);
  return agents;
}

export async function refreshAgents(force = false): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_refresh", { force });
  publishAgentRegistry(agents);
  return agents;
}

export async function getAgent(id: string): Promise<DetectedAgent | null> {
  return invoke<DetectedAgent | null>("agent_registry_get", { id });
}

export async function testCustomAgent(input: CustomAgentInput): Promise<ProbeResult> {
  return invoke<ProbeResult>("agent_registry_test_custom", normalizeCustomAgentInput(input));
}

export async function saveCustomAgent(input: CustomAgentInput): Promise<DetectedAgent> {
  return invoke<DetectedAgent>("agent_registry_save_custom", normalizeCustomAgentInput(input));
}

export async function deleteCustomAgent(id: string): Promise<void> {
  return invoke<void>("agent_registry_delete_custom", { id });
}

export type BuiltinInstallableKind = Exclude<DetectedAgentKind, "custom" | "cursor">;
export type BuiltinUninstallableKind = Exclude<DetectedAgentKind, "custom">;

export async function installBuiltinAgent(kind: BuiltinInstallableKind): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_install_builtin", { kind });
  publishAgentRegistry(agents);
  return agents;
}

export async function uninstallBuiltinAgent(kind: BuiltinUninstallableKind): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_uninstall_builtin", { kind });
  publishAgentRegistry(agents);
  return agents;
}

export async function updateBuiltinAgent(kind: BuiltinInstallableKind): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_update_builtin", { kind });
  publishAgentRegistry(agents);
  return agents;
}

function normalizeCustomAgentInput(input: CustomAgentInput): Record<string, unknown> {
  return {
    id: input.id ?? null,
    name: input.name,
    command: input.command,
    args: input.args,
    env: input.env,
  };
}
