import { useEffect, useSyncExternalStore } from "react";
import { listAgents } from "../services/agentRegistry";
import {
  getAgentRegistrySnapshot,
  selectDeepseekAvailable,
  subscribeAgentRegistry,
} from "../stores/agentRegistryStore";

export function useAgentRegistryDeepseekAvailable(): boolean {
  useEffect(() => {
    void listAgents().catch(() => {});
  }, []);

  return useSyncExternalStore(
    subscribeAgentRegistry,
    () => selectDeepseekAvailable(getAgentRegistrySnapshot()),
    () => selectDeepseekAvailable(getAgentRegistrySnapshot()),
  );
}
