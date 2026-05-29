import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceMemoDisplayItem,
  WorkspaceMemoItem,
  WorkspaceMemoScope,
  WorkspaceMemoSelection,
} from "../types/workspaceMemos";
import {
  loadProjectWorkspaceMemos,
  loadRepositoryWorkspaceMemos,
  saveProjectWorkspaceMemos,
  saveRepositoryWorkspaceMemos,
} from "../services/workspaceMemosStore";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "备忘录保存失败";
}

export interface UseWorkspaceMemosInput {
  projectId: string | null;
  repositoryId: number | null;
}

export function useWorkspaceMemos({ projectId, repositoryId }: UseWorkspaceMemosInput) {
  const [projectItems, setProjectItems] = useState<WorkspaceMemoItem[]>([]);
  const [repositoryItems, setRepositoryItems] = useState<WorkspaceMemoItem[]>([]);
  const [projectLastSelectedId, setProjectLastSelectedId] = useState<string | null>(null);
  const [repositoryLastSelectedId, setRepositoryLastSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<WorkspaceMemoSelection | null>(null);

  const projectItemsRef = useRef(projectItems);
  const repositoryItemsRef = useRef(repositoryItems);
  const projectLastSelectedRef = useRef(projectLastSelectedId);
  const repositoryLastSelectedRef = useRef(repositoryLastSelectedId);
  const persistTimersRef = useRef<{
    project: ReturnType<typeof setTimeout> | null;
    repository: ReturnType<typeof setTimeout> | null;
  }>({ project: null, repository: null });

  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;
  projectLastSelectedRef.current = projectLastSelectedId;
  repositoryLastSelectedRef.current = repositoryLastSelectedId;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [projectPayload, repositoryPayload] = await Promise.all([
        projectId?.trim()
          ? loadProjectWorkspaceMemos(projectId)
          : Promise.resolve({ version: 1 as const, items: [], lastSelectedId: null }),
        repositoryId != null
          ? loadRepositoryWorkspaceMemos(repositoryId)
          : Promise.resolve({ version: 1 as const, items: [], lastSelectedId: null }),
      ]);
      setProjectItems(projectPayload.items);
      setRepositoryItems(repositoryPayload.items);
      setProjectLastSelectedId(projectPayload.lastSelectedId ?? null);
      setRepositoryLastSelectedId(repositoryPayload.lastSelectedId ?? null);
    } catch (error) {
      message.error(persistErrorText(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, repositoryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelection(null);
  }, [projectId, repositoryId]);

  const displayItems = useMemo(() => {
    const rows: WorkspaceMemoDisplayItem[] = [];
    if (projectId?.trim()) {
      for (const item of projectItems) {
        rows.push({ ...item, scope: "project" });
      }
    }
    if (repositoryId != null) {
      for (const item of repositoryItems) {
        rows.push({ ...item, scope: "repository" });
      }
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  }, [projectId, repositoryId, projectItems, repositoryItems]);

  const selectedMemo = useMemo(() => {
    if (!selection) return null;
    return (
      displayItems.find((row) => row.scope === selection.scope && row.id === selection.id) ?? null
    );
  }, [displayItems, selection]);

  useEffect(() => {
    if (loading || displayItems.length === 0) return;
    if (selection && displayItems.some((row) => row.scope === selection.scope && row.id === selection.id)) {
      return;
    }
    const preferProject =
      projectLastSelectedId &&
      displayItems.find((row) => row.scope === "project" && row.id === projectLastSelectedId);
    if (preferProject) {
      setSelection({ scope: "project", id: preferProject.id });
      return;
    }
    const preferRepo =
      repositoryLastSelectedId &&
      displayItems.find((row) => row.scope === "repository" && row.id === repositoryLastSelectedId);
    if (preferRepo) {
      setSelection({ scope: "repository", id: preferRepo.id });
      return;
    }
    const first = displayItems[0];
    if (first) {
      setSelection({ scope: first.scope, id: first.id });
    }
  }, [loading, displayItems, selection, projectLastSelectedId, repositoryLastSelectedId]);

  const flushPersist = useCallback(
    async (
      scope: WorkspaceMemoScope,
      items: WorkspaceMemoItem[],
      lastSelectedId: string | null,
    ) => {
      const timers = persistTimersRef.current;
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = null;
        const pid = projectId?.trim();
        if (!pid) return false;
        try {
          await saveProjectWorkspaceMemos(pid, items, lastSelectedId);
          setProjectLastSelectedId(lastSelectedId);
          return true;
        } catch (error) {
          message.error(persistErrorText(error));
          return false;
        }
      }
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = null;
      if (repositoryId == null) return false;
      try {
        await saveRepositoryWorkspaceMemos(repositoryId, items, lastSelectedId);
        setRepositoryLastSelectedId(lastSelectedId);
        return true;
      } catch (error) {
        message.error(persistErrorText(error));
        return false;
      }
    },
    [projectId, repositoryId],
  );

  const schedulePersist = useCallback(
    (scope: WorkspaceMemoScope, items: WorkspaceMemoItem[], lastSelectedId: string | null) => {
      const timers = persistTimersRef.current;
      const run = () => {
        void flushPersist(scope, items, lastSelectedId);
      };
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = setTimeout(() => {
          timers.project = null;
          run();
        }, PERSIST_DEBOUNCE_MS);
        return;
      }
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = setTimeout(() => {
        timers.repository = null;
        run();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  const setItemsForScope = useCallback(
    (scope: WorkspaceMemoScope, items: WorkspaceMemoItem[], lastSelectedId?: string | null) => {
      const resolvedLast =
        lastSelectedId !== undefined
          ? lastSelectedId
          : scope === "project"
            ? projectLastSelectedRef.current
            : repositoryLastSelectedRef.current;
      if (scope === "project") {
        setProjectItems(items);
        schedulePersist("project", items, resolvedLast);
        return;
      }
      setRepositoryItems(items);
      schedulePersist("repository", items, resolvedLast);
    },
    [schedulePersist],
  );

  const selectMemo = useCallback(
    (next: WorkspaceMemoSelection | null) => {
      setSelection(next);
      if (!next) return;
      if (next.scope === "project") {
        setProjectLastSelectedId(next.id);
        schedulePersist("project", projectItemsRef.current, next.id);
        return;
      }
      setRepositoryLastSelectedId(next.id);
      schedulePersist("repository", repositoryItemsRef.current, next.id);
    },
    [schedulePersist],
  );

  const hasScope = Boolean(projectId?.trim()) || repositoryId != null;

  return {
    loading,
    hasScope,
    displayItems,
    selectedMemo,
    selection,
    selectMemo,
    setItemsForScope,
    flushPersist,
    projectItemsRef,
    repositoryItemsRef,
    refresh,
  };
}
