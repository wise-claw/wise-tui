import { invoke } from "@tauri-apps/api/core";
import { publishAgentRegistry, publishLatestVersions } from "../stores/agentRegistryStore";
import type {
  CustomAgentInput,
  DetectedAgent,
  DetectedAgentKind,
  LatestVersionInfo,
  ProbeResult,
} from "../types/detectedAgent";

let listInFlight: Promise<DetectedAgent[]> | null = null;
/** Bumped by every call that publishes a registry snapshot, so a slower list response cannot overwrite a newer one. */
let publishEpoch = 0;

function publishFresh(agents: DetectedAgent[]): void {
  publishEpoch += 1;
  publishAgentRegistry(agents);
}

/** Concurrent callers (several availability hooks mount together at startup) share one IPC round-trip. */
export function listAgents(): Promise<DetectedAgent[]> {
  if (listInFlight) return listInFlight;
  const startedAt = publishEpoch;
  const request = invoke<DetectedAgent[]>("agent_registry_list").then((agents) => {
    if (publishEpoch === startedAt) publishFresh(agents);
    return agents;
  });
  listInFlight = request;
  request
    .finally(() => {
      if (listInFlight === request) listInFlight = null;
    })
    .catch(() => {});
  return request;
}

export async function refreshAgents(force = false): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_refresh", { force });
  publishFresh(agents);
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
  publishFresh(agents);
  return agents;
}

export async function uninstallBuiltinAgent(kind: BuiltinUninstallableKind): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_uninstall_builtin", { kind });
  publishFresh(agents);
  return agents;
}

export async function updateBuiltinAgent(kind: BuiltinInstallableKind): Promise<DetectedAgent[]> {
  const agents = await invoke<DetectedAgent[]>("agent_registry_update_builtin", { kind });
  publishFresh(agents);
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

/**
 * 查询单个 kind 的最新版本(5min 后端缓存)。
 * cursor / custom 返回 `manual=true + latest=undefined`,由调用方按 manual 提示「手动更新」。
 */
export async function checkBuiltinAgentLatest(
  kind: string,
): Promise<LatestVersionInfo> {
  try {
    return await invoke<LatestVersionInfo>("agent_registry_check_latest", { kind });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}

/** 批量查询所有内置 kind + cursor + custom agents 的最新版本,同步 publish 到 store。 */
export async function checkAllBuiltinAgentUpdates(
  force = false,
): Promise<LatestVersionInfo[]> {
  try {
    const list = await invoke<LatestVersionInfo[]>("agent_registry_check_updates", { force });
    publishLatestVersions(list);
    return list;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}
