import { useEffect, useSyncExternalStore } from "react";
import { listAgents } from "../services/agentRegistry";
import {
  getAgentRegistrySnapshot,
  selectOpencodeAvailable,
  subscribeAgentRegistry,
} from "../stores/agentRegistryStore";

export function useAgentRegistryOpencodeAvailable(): boolean {
  useEffect(() => {
    void listAgents().catch(() => {});
  }, []);

  return useSyncExternalStore(
    subscribeAgentRegistry,
    () => selectOpencodeAvailable(getAgentRegistrySnapshot()),
    () => selectOpencodeAvailable(getAgentRegistrySnapshot()),
  );
}
