import { useEffect, useSyncExternalStore } from "react";
import { listAgents } from "../services/agentRegistry";
import {
  getAgentRegistrySnapshot,
  selectGeminiAvailable,
  subscribeAgentRegistry,
} from "../stores/agentRegistryStore";

export function useAgentRegistryGeminiAvailable(): boolean {
  useEffect(() => {
    void listAgents().catch(() => {});
  }, []);

  return useSyncExternalStore(
    subscribeAgentRegistry,
    () => selectGeminiAvailable(getAgentRegistrySnapshot()),
    () => selectGeminiAvailable(getAgentRegistrySnapshot()),
  );
}
