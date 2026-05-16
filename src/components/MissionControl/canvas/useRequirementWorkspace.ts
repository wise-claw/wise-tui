import { useEffect, useRef, useState } from "react";
import type {
  TrellisRequirementWorkspaceSnapshot,
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
} from "../../../services/trellisTaskBridge";
import { listProjectRequirementWorkspace } from "../../../services/trellisTaskBridge";
import type { ProjectItem, Repository } from "../../../types";
import type { ProjectRef } from "../../PrdSplitWizard/types";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface UseRequirementWorkspaceInput {
  project: ProjectItem | ProjectRef | null;
  projects: ProjectItem[];
  repositories: Repository[];
}

export function useRequirementWorkspace(input: UseRequirementWorkspaceInput) {
  const [snapshot, setSnapshot] = useState<TrellisRequirementWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const project = input.project;
    if (!project) {
      setSnapshot(null);
      return;
    }

    const projectId = project.id?.trim();
    const fullProject = projectId
      ? input.projects.find((p) => p.id === projectId) ?? null
      : null;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const fetch = async (isInitial = false) => {
      if (cancelled) return;
      if (isInitial) setLoading(true);
      const cur = inputRef.current;
      try {
        const result = await listProjectRequirementWorkspace({
          project: fullProject ?? (cur.project as ProjectItem),
          projects: cur.projects,
          repositories: cur.repositories,
        });
        if (!cancelled) setSnapshot(result);
      } catch {
        if (!cancelled && isInitial) setSnapshot(null);
      } finally {
        if (!cancelled && isInitial) setLoading(false);
      }
    };

    // Initial fetch
    fetch(true);

    // React to Trellis changes from multiple sources:
    //   1. Rust backend emits on task lifecycle / agent run / spec revision
    //   2. ClaudeChat dispatches after agent turns that produce Trellis output
    //   3. Repo worktree changes may indicate new task files
    const eventNames = [
      "trellis-runtime-event",
      "wise:split-todo-count-updated",
      "wise:repo-worktrees-may-have-changed",
    ];
    for (const name of eventNames) {
      listen<unknown>(name, () => {
        fetch(false);
      }).then((fn) => unlisteners.push(fn));
    }

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [input.project?.id, input.projects, input.repositories]);

  return { snapshot, loading };
}

/** Build a lookup map: taskId → tasks that belong to it (children) */
export function buildTaskChildrenMap(
  tasks: TrellisRequirementTaskRow[],
): Map<string, TrellisRequirementTaskRow[]> {
  const map = new Map<string, TrellisRequirementTaskRow[]>();
  for (const task of tasks) {
    const parent = task.parent?.trim();
    if (parent) {
      const list = map.get(parent) ?? [];
      list.push(task);
      map.set(parent, list);
    }
  }
  return map;
}

/** Build lookup: prd taskId → its direct child tasks */
export function buildPrdChildTaskMap(
  prds: TrellisRequirementPrdRow[],
  tasks: TrellisRequirementTaskRow[],
): Map<string, TrellisRequirementTaskRow[]> {
  const taskById = new Map(tasks.map((t) => [t.taskId, t]));
  const map = new Map<string, TrellisRequirementTaskRow[]>();
  for (const prd of prds) {
    const children = prd.childTaskIds
      .map((id) => taskById.get(id))
      .filter((t): t is TrellisRequirementTaskRow => Boolean(t));
    map.set(prd.taskId, children);
  }
  return map;
}
