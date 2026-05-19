import { invoke } from "@tauri-apps/api/core";
import type { CustomAgentInput, DetectedAgent, ProbeResult } from "../types/detectedAgent";

export async function listAgents(): Promise<DetectedAgent[]> {
  return invoke<DetectedAgent[]>("agent_registry_list");
}

export async function refreshAgents(force = false): Promise<DetectedAgent[]> {
  return invoke<DetectedAgent[]>("agent_registry_refresh", { force });
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

function normalizeCustomAgentInput(input: CustomAgentInput): Record<string, unknown> {
  return {
    id: input.id ?? null,
    name: input.name,
    command: input.command,
    args: input.args,
    env: input.env,
  };
}
