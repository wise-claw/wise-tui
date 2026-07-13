import type { DetectedAgent, LatestVersionInfo } from "../types/detectedAgent";
import { isAgentKind } from "../types/detectedAgent";

type Listener = () => void;

export type AgentRegistryStoreSnapshot = {
  agents: DetectedAgent[];
  loaded: boolean;
  /** 来自后端 `agent_registry_check_updates` 的批量结果,按 kind(`"claude"` / `"custom:abc"`)索引。 */
  latestByKind: ReadonlyMap<string, LatestVersionInfo>;
};

let agents: DetectedAgent[] = [];
let loaded = false;
let latestByKind: ReadonlyMap<string, LatestVersionInfo> = new Map();
let snapshot: AgentRegistryStoreSnapshot = { agents, loaded, latestByKind };
const listeners = new Set<Listener>();

export function getAgentRegistrySnapshot(): AgentRegistryStoreSnapshot {
  return snapshot;
}

export function subscribeAgentRegistry(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishAgentRegistry(nextAgents: DetectedAgent[]): void {
  agents = nextAgents;
  loaded = true;
  snapshot = { agents, loaded, latestByKind };
  for (const fn of listeners) {
    fn();
  }
}

export function publishLatestVersions(list: LatestVersionInfo[]): void {
  if (list.length === 0) return;
  const next = new Map(latestByKind);
  for (const info of list) {
    next.set(info.kind, info);
  }
  latestByKind = next;
  snapshot = { agents, loaded, latestByKind };
  for (const fn of listeners) {
    fn();
  }
}

export function selectCodexAvailable(snap: AgentRegistryStoreSnapshot): boolean {
  if (!snap.loaded) return false;
  return snap.agents.some((agent) => isAgentKind(agent, "codex") && agent.available);
}

export function selectCursorAvailable(snap: AgentRegistryStoreSnapshot): boolean {
  if (!snap.loaded) return false;
  return snap.agents.some((agent) => isAgentKind(agent, "cursor") && agent.available);
}

export function selectGeminiAvailable(snap: AgentRegistryStoreSnapshot): boolean {
  if (!snap.loaded) return false;
  return snap.agents.some((agent) => isAgentKind(agent, "gemini") && agent.available);
}

export function selectOpencodeAvailable(snap: AgentRegistryStoreSnapshot): boolean {
  if (!snap.loaded) return false;
  return snap.agents.some((agent) => isAgentKind(agent, "opencode") && agent.available);
}

export function selectLatestForKind(
  snap: AgentRegistryStoreSnapshot,
  kind: string,
): LatestVersionInfo | undefined {
  return snap.latestByKind.get(kind);
}

export function selectUpgradableCount(snap: AgentRegistryStoreSnapshot): number {
  let n = 0;
  for (const v of snap.latestByKind.values()) {
    if (v.upgradable) n++;
  }
  return n;
}