import { useCallback, useMemo, useState } from "react";
import {
  parseWorkspaceMemoTabKey,
  type WorkspaceMemoSelection,
  workspaceMemoTabKey,
} from "../types/workspaceMemos";

export function useWorkspaceMemoEditor() {
  const [openTabKeys, setOpenTabKeys] = useState<string[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);

  const editorVisible = openTabKeys.length > 0;

  const openTabs = useMemo(() => {
    const rows: WorkspaceMemoSelection[] = [];
    for (const key of openTabKeys) {
      const parsed = parseWorkspaceMemoTabKey(key);
      if (parsed) rows.push(parsed);
    }
    return rows;
  }, [openTabKeys]);

  const activeSelection = useMemo(() => {
    if (!activeTabKey) return null;
    return parseWorkspaceMemoTabKey(activeTabKey);
  }, [activeTabKey]);

  const openMemo = useCallback((selection: WorkspaceMemoSelection) => {
    const key = workspaceMemoTabKey(selection.scope, selection.id);
    setOpenTabKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setActiveTabKey(key);
  }, []);

  const closeMemoTab = useCallback((selection: WorkspaceMemoSelection) => {
    const key = workspaceMemoTabKey(selection.scope, selection.id);
    setOpenTabKeys((prev) => {
      const next = prev.filter((entry) => entry !== key);
      setActiveTabKey((current) => {
        if (current !== key) return current;
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }, []);

  const closeMemoEditorPanel = useCallback(() => {
    setOpenTabKeys([]);
    setActiveTabKey(null);
  }, []);

  const setActiveMemo = useCallback((selection: WorkspaceMemoSelection) => {
    const key = workspaceMemoTabKey(selection.scope, selection.id);
    setOpenTabKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setActiveTabKey(key);
  }, []);

  return {
    editorVisible,
    openTabs,
    activeSelection,
    activeTabKey,
    openMemo,
    closeMemoTab,
    closeMemoEditorPanel,
    setActiveMemo,
  };
}
