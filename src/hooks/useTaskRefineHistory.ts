import { useCallback, useMemo, useState } from "react";
import type { SplitResult, TaskRefinePatch, TaskSplitSnapshot } from "../types";
import { applyTaskRefinePatch, createTaskSplitSnapshot } from "../services/taskRefine";

export function useTaskRefineHistory(initial: SplitResult | null = null) {
  const [snapshots, setSnapshots] = useState<TaskSplitSnapshot[]>(
    initial ? [createTaskSplitSnapshot(1, "v1 initial", initial)] : [],
  );
  const [currentVersion, setCurrentVersion] = useState(initial ? 1 : 0);

  const current = useMemo(
    () => snapshots.find((item) => item.version === currentVersion) ?? null,
    [snapshots, currentVersion],
  );

  const applyPatch = useCallback(
    (patch: TaskRefinePatch, label = "manual refine") => {
      if (!current) return null;
      const nextResult = applyTaskRefinePatch(current.result, patch);
      const nextVersion = snapshots.length + 1;
      const nextSnapshot = createTaskSplitSnapshot(nextVersion, `v${nextVersion} ${label}`, nextResult);
      setSnapshots((prev) => [...prev, nextSnapshot]);
      setCurrentVersion(nextVersion);
      return nextSnapshot;
    },
    [current, snapshots.length],
  );

  const reset = useCallback((result: SplitResult) => {
    const first = createTaskSplitSnapshot(1, "v1 initial", result);
    setSnapshots([first]);
    setCurrentVersion(1);
  }, []);

  const hydrate = useCallback((nextSnapshots: TaskSplitSnapshot[], nextCurrentVersion: number) => {
    if (nextSnapshots.length === 0) {
      setSnapshots([]);
      setCurrentVersion(0);
      return;
    }
    const valid = nextSnapshots.some((item) => item.version === nextCurrentVersion);
    setSnapshots(nextSnapshots);
    setCurrentVersion(valid ? nextCurrentVersion : nextSnapshots[nextSnapshots.length - 1].version);
  }, []);

  const appendSnapshot = useCallback((result: SplitResult, label = "update") => {
    const nextVersion = snapshots.length + 1;
    const nextSnapshot = createTaskSplitSnapshot(nextVersion, `v${nextVersion} ${label}`, result);
    setSnapshots((prev) => [...prev, nextSnapshot]);
    setCurrentVersion(nextVersion);
    return nextSnapshot;
  }, [snapshots.length]);

  return {
    snapshots,
    currentVersion,
    current,
    setCurrentVersion,
    applyPatch,
    appendSnapshot,
    reset,
    hydrate,
  };
}
