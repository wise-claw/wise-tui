import { useCallback, useSyncExternalStore } from "react";
import { getActivePaneIndex, subscribeActivePaneIndex } from "../stores/activePaneIndexStore";
import {
  getPaneEditorPanelContextSnapshot,
  subscribePaneEditorPanelContext,
} from "../stores/paneEditorPanelContextStore";
import { repositoryPathsMatch } from "../utils/repositoryMainSessionBinding";
import type { FileEditorTab } from "./useRepositoryFileEditor";

type EditorSelectionContext = {
  activePath: string | null;
  editorVisible: boolean;
  tabs: Pick<FileEditorTab, "relativePath" | "rootPath" | "gitDiffSection">[];
};

/** 只订阅文件身份；编辑正文、加载状态变化不触发整个 Git 列表重渲。 */
export function getGitChangesSelectionSnapshot(repositoryPath: string, paneIndex: number): string {
  const context = getPaneEditorPanelContextSnapshot(paneIndex) as EditorSelectionContext | null;
  if (!context?.editorVisible || !context.activePath) return "";
  const tab = context.tabs.find((item) => item.relativePath === context.activePath);
  if (!tab || !repositoryPathsMatch(tab.rootPath, repositoryPath)) return "";
  return `${tab.gitDiffSection ?? ""}\0${tab.relativePath}`;
}

const emptySnapshot = () => "";
const primaryPaneSnapshot = () => null;

export function useGitChangesSelection(repositoryPath: string) {
  const activePaneIndex = useSyncExternalStore(subscribeActivePaneIndex, getActivePaneIndex, primaryPaneSnapshot);
  const paneIndex = activePaneIndex ?? 0;
  const subscribe = useCallback(
    (listener: () => void) => subscribePaneEditorPanelContext(paneIndex, listener),
    [paneIndex],
  );
  const getSnapshot = useCallback(
    () => getGitChangesSelectionSnapshot(repositoryPath, paneIndex),
    [repositoryPath, paneIndex],
  );
  const key = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
  const separator = key.indexOf("\0");
  const path = separator < 0 ? null : key.slice(separator + 1);
  const section = separator < 0 ? "" : key.slice(0, separator);
  return {
    stagedPath: section === "unstaged" ? null : path,
    unstagedPath: section === "staged" ? null : path,
  };
}
