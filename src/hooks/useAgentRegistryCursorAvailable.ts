import { useEffect, useSyncExternalStore } from "react";
import { listAgents } from "../services/agentRegistry";
import {
  getAgentRegistrySnapshot,
  selectCursorAvailable,
  subscribeAgentRegistry,
} from "../stores/agentRegistryStore";

export function useAgentRegistryCursorAvailable(): boolean {
  useEffect(() => {
    void listAgents().catch(() => {});
  }, []);

  return useSyncExternalStore(
    subscribeAgentRegistry,
    () => selectCursorAvailable(getAgentRegistrySnapshot()),
    () => selectCursorAvailable(getAgentRegistrySnapshot()),
  );
}
