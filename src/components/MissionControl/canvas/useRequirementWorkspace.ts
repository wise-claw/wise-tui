import { useEffect, useRef, useState } from "react";
import type {
  TrellisRequirementWorkspaceSnapshot,
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
} from "../../../services/trellisTaskBridge";
import { listTrellisRequirementWorkspace } from "../../../services/trellisTaskBridge";
import { buildProjectRequirementWorkspaceInput } from "../../../services/trellisTaskBridge";
import type { ProjectItem, Repository } from "../../../types";
import type { ProjectRef } from "../../PrdSplitWizard/types";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../../utils/safeTauriUnlisten";

interface UseRequirementWorkspaceInput {
  project: ProjectItem | ProjectRef | null;
  projects: ProjectItem[];
  repositories: Repository[];
  includeArchived?: boolean;
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

    if (!fullProject) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const fetch = async (isInitial = false) => {
      if (cancelled) return;
      if (isInitial) setLoading(true);
      const cur = inputRef.current;
      try {
        const wsInput = buildProjectRequirementWorkspaceInput({
          project: fullProject,
          projects: cur.projects,
          repositories: cur.repositories,
        });
        const result = await listTrellisRequirementWorkspace({
          ...wsInput,
          includeArchived: cur.includeArchived ?? false,
        });
        if (!cancelled) setSnapshot(result);
      } catch {
        if (!cancelled && isInitial) setSnapshot(null);
      } finally {
        if (!cancelled && isInitial) setLoading(false);
      }
    };

    fetch(true);

    const eventNames = [
      "trellis-runtime-event",
      "wise:split-todo-count-updated",
      "wise:repo-worktrees-may-have-changed",
    ];
    for (const name of eventNames) {
      listen<unknown>(name, () => { fetch(false); }).then((fn) => unlisteners.push(fn));
    }

    return () => {
      cancelled = true;
      for (const fn of unlisteners) safeUnlisten(fn);
    };
  }, [input.project?.id, input.projects, input.repositories, input.includeArchived]);

  return { snapshot, loading };
}

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
