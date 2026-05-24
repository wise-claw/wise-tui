import { useEffect, useSyncExternalStore } from "react";
import { listAgents } from "../services/agentRegistry";
import {
  getAgentRegistrySnapshot,
  selectCodexAvailable,
  subscribeAgentRegistry,
} from "../stores/agentRegistryStore";

export function useAgentRegistryCodexAvailable(): boolean {
  useEffect(() => {
    void listAgents().catch(() => {});
  }, []);

  return useSyncExternalStore(
    subscribeAgentRegistry,
    () => selectCodexAvailable(getAgentRegistrySnapshot()),
    () => selectCodexAvailable(getAgentRegistrySnapshot()),
  );
}
