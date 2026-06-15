import type { DetectedAgent } from "../types/detectedAgent";
import { isAgentKind } from "../types/detectedAgent";

type Listener = () => void;

export type AgentRegistryStoreSnapshot = {
  agents: DetectedAgent[];
  loaded: boolean;
};

let agents: DetectedAgent[] = [];
let loaded = false;
let snapshot: AgentRegistryStoreSnapshot = { agents, loaded };
const listeners = new Set<Listener>();

export function getAgentRegistrySnapshot(): AgentRegistryStoreSnapshot {
  return snapshot;
}

export function subscribeAgentRegistry(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishAgentRegistry(nextAgents: DetectedAgent[]): void {
  agents = nextAgents;
  loaded = true;
  snapshot = { agents, loaded };
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
