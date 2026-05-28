import { useCallback, useSyncExternalStore } from "react";
import {
  getRepositoryRunCommandRunningByRepositoryId,
  subscribeRepositoryRunCommandRuntime,
} from "../stores/repositoryRunCommandRuntimeStore";

export function useRepositoryRunCommandIndicators() {
  const subscribe = useCallback(
    (listener: () => void) => subscribeRepositoryRunCommandRuntime(listener),
    [],
  );

  const getSnapshot = useCallback(
    () => getRepositoryRunCommandRunningByRepositoryId(),
    [],
  );

  const runningByRepositoryId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { runningByRepositoryId };
}
