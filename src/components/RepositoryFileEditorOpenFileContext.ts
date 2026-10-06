import { createContext, useCallback, useContext } from "react";
import { markPaneActive } from "../stores/activePaneIndexStore";
import type { GitPanelOpenFileOptions } from "./GitPanel/types";

export type OpenRepositoryFileHandler = (path: string, options?: GitPanelOpenFileOptions) => void;

export const RepositoryFileEditorOpenFileContext = createContext<OpenRepositoryFileHandler | null>(null);

export function useRepositoryFileEditorOpenFile(): OpenRepositoryFileHandler {
  const value = useContext(RepositoryFileEditorOpenFileContext);
  if (!value) {
    throw new Error("Repository file editor open file context is missing");
  }
  return value;
}

/** 固定入口的目标屏，优先于最近聚焦屏和文件树新屏偏好。 */
export function useRepositoryFileEditorOpenFileInPane(paneIndex: number): OpenRepositoryFileHandler {
  const openFile = useRepositoryFileEditorOpenFile();
  return useCallback((path, options) => {
    markPaneActive(paneIndex);
    openFile(path, { ...options, targetPaneIndex: paneIndex });
  }, [openFile, paneIndex]);
}
