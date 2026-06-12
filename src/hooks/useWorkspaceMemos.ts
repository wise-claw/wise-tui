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

function resolveWorkspaceMemoScopeId(
  scope: WorkspaceMemoScope,
  projectId: string | null,
  repositoryId: number | null,
): string | null {
  if (scope === "project") {
    const id = projectId?.trim() ?? "";
    return id || null;
  }
  if (repositoryId == null || !Number.isFinite(repositoryId)) return null;
  return String(repositoryId);
}

interface PendingMemoPersist {
  scope: WorkspaceMemoScope;
  scopeId: string;
  items: WorkspaceMemoItem[];
  lastSelectedId: string | null;
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
  const pendingPersistRef = useRef<{
    project: PendingMemoPersist | null;
    repository: PendingMemoPersist | null;
  }>({ project: null, repository: null });
  const loadGenerationRef = useRef(0);
  const prevScopeRef = useRef({ projectId, repositoryId });

  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;
  projectLastSelectedRef.current = projectLastSelectedId;
  repositoryLastSelectedRef.current = repositoryLastSelectedId;

  const refresh = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
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
      if (generation !== loadGenerationRef.current) return;
      setProjectItems(projectPayload.items);
      setRepositoryItems(repositoryPayload.items);
      setProjectLastSelectedId(projectPayload.lastSelectedId ?? null);
      setRepositoryLastSelectedId(repositoryPayload.lastSelectedId ?? null);
    } catch (error) {
      if (generation === loadGenerationRef.current) {
        message.error(persistErrorText(error));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [projectId, repositoryId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGenerationRef.current += 1;
    };
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

  const flushPersistForScope = useCallback(async (pending: PendingMemoPersist) => {
    const timers = persistTimersRef.current;
    if (pending.scope === "project") {
      if (timers.project) clearTimeout(timers.project);
      timers.project = null;
      pendingPersistRef.current.project = null;
      try {
        await saveProjectWorkspaceMemos(pending.scopeId, pending.items, pending.lastSelectedId);
        setProjectLastSelectedId(pending.lastSelectedId);
        return true;
      } catch (error) {
        message.error(persistErrorText(error));
        return false;
      }
    }
    if (timers.repository) clearTimeout(timers.repository);
    timers.repository = null;
    pendingPersistRef.current.repository = null;
    try {
      await saveRepositoryWorkspaceMemos(Number(pending.scopeId), pending.items, pending.lastSelectedId);
      setRepositoryLastSelectedId(pending.lastSelectedId);
      return true;
    } catch (error) {
      message.error(persistErrorText(error));
      return false;
    }
  }, []);

  const flushPersist = useCallback(
    async (
      scope: WorkspaceMemoScope,
      items: WorkspaceMemoItem[],
      lastSelectedId: string | null,
    ) => {
      const scopeId = resolveWorkspaceMemoScopeId(scope, projectId, repositoryId);
      if (!scopeId) return false;
      return flushPersistForScope({ scope, scopeId, items, lastSelectedId });
    },
    [flushPersistForScope, projectId, repositoryId],
  );

  const schedulePersist = useCallback(
    (scope: WorkspaceMemoScope, scopeId: string, items: WorkspaceMemoItem[], lastSelectedId: string | null) => {
      const timers = persistTimersRef.current;
      const pending: PendingMemoPersist = { scope, scopeId, items, lastSelectedId };
      const run = () => {
        void flushPersistForScope(pending);
      };
      if (scope === "project") {
        pendingPersistRef.current.project = pending;
        if (timers.project) clearTimeout(timers.project);
        timers.project = setTimeout(() => {
          timers.project = null;
          run();
        }, PERSIST_DEBOUNCE_MS);
        return;
      }
      pendingPersistRef.current.repository = pending;
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = setTimeout(() => {
        timers.repository = null;
        run();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersistForScope],
  );

  const flushPendingForScopeChange = useCallback(
    (scope: WorkspaceMemoScope, scopeId: string | null) => {
      if (!scopeId) return;
      const timers = persistTimersRef.current;
      const pending = pendingPersistRef.current;
      const bucket = scope === "project" ? pending.project : pending.repository;
      if (scope === "project" && timers.project) {
        clearTimeout(timers.project);
        timers.project = null;
      }
      if (scope === "repository" && timers.repository) {
        clearTimeout(timers.repository);
        timers.repository = null;
      }
      if (!bucket || bucket.scopeId !== scopeId) return;
      if (scope === "project") pending.project = null;
      else pending.repository = null;
      void flushPersistForScope(bucket);
    },
    [flushPersistForScope],
  );

  useEffect(() => {
    const prev = prevScopeRef.current;
    if (prev.projectId !== projectId) {
      const oldId = prev.projectId?.trim() ?? null;
      flushPendingForScopeChange("project", oldId);
    }
    if (prev.repositoryId !== repositoryId) {
      const oldId =
        prev.repositoryId != null && Number.isFinite(prev.repositoryId)
          ? String(prev.repositoryId)
          : null;
      flushPendingForScopeChange("repository", oldId);
    }
    prevScopeRef.current = { projectId, repositoryId };
  }, [projectId, repositoryId, flushPendingForScopeChange]);

  useEffect(
    () => () => {
      const timers = persistTimersRef.current;
      const pending = pendingPersistRef.current;
      if (timers.project) {
        clearTimeout(timers.project);
        timers.project = null;
        if (pending.project) {
          void flushPersistForScope(pending.project);
          pending.project = null;
        }
      }
      if (timers.repository) {
        clearTimeout(timers.repository);
        timers.repository = null;
        if (pending.repository) {
          void flushPersistForScope(pending.repository);
          pending.repository = null;
        }
      }
    },
    [flushPersistForScope],
  );

  const setItemsForScope = useCallback(
    (scope: WorkspaceMemoScope, items: WorkspaceMemoItem[], lastSelectedId?: string | null) => {
      const scopeId = resolveWorkspaceMemoScopeId(scope, projectId, repositoryId);
      if (!scopeId) return;
      const resolvedLast =
        lastSelectedId !== undefined
          ? lastSelectedId
          : scope === "project"
            ? projectLastSelectedRef.current
            : repositoryLastSelectedRef.current;
      if (scope === "project") {
        setProjectItems(items);
        schedulePersist("project", scopeId, items, resolvedLast);
        return;
      }
      setRepositoryItems(items);
      schedulePersist("repository", scopeId, items, resolvedLast);
    },
    [projectId, repositoryId, schedulePersist],
  );

  const selectMemo = useCallback(
    (next: WorkspaceMemoSelection | null) => {
      setSelection(next);
      if (!next) return;
      const scopeId = resolveWorkspaceMemoScopeId(next.scope, projectId, repositoryId);
      if (!scopeId) return;
      if (next.scope === "project") {
        setProjectLastSelectedId(next.id);
        schedulePersist("project", scopeId, projectItemsRef.current, next.id);
        return;
      }
      setRepositoryLastSelectedId(next.id);
      schedulePersist("repository", scopeId, repositoryItemsRef.current, next.id);
    },
    [projectId, repositoryId, schedulePersist],
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
