import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { markPaneActive } from "../../stores/activePaneIndexStore";
import {
  clampWorkspaceFileTreeRailWidthPx,
  WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX,
} from "../../utils/workspaceFileTreeRailStorage";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import { MainLayoutResizeHandle } from "../MainLayoutResizeHandle";
import { useRepositoryFileEditorOpenFile } from "../RepositoryFileEditorOpenFileContext";
import { WorkspaceFileTreeRail } from "../WorkspaceFileTreeRail";
import "./PaneWorkspace.css";

interface PaneFileTreeControls {
  fileTreeRailOpen: boolean;
  onToggleFileTree: () => void;
}

interface PaneWorkspaceProps {
  paneIndex: number;
  repositoryPath: string;
  repositoryName: string;
  paneRef?: Ref<HTMLDivElement>;
  cornerButton?: ReactNode;
  children: (controls: PaneFileTreeControls) => ReactNode;
}

export function PaneWorkspace({
  paneIndex,
  repositoryPath,
  repositoryName,
  paneRef,
  cornerButton,
  children,
}: PaneWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [widthPx, setWidthPx] = useState(WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX);
  const [paneWidthPx, setPaneWidthPx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (typeof paneRef === "function") paneRef(node);
    else if (paneRef) paneRef.current = node;
  }, [paneRef]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPaneWidthPx(root.clientWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const displayedWidthPx = paneWidthPx == null ? widthPx : Math.min(widthPx, paneWidthPx * 0.45);
  const openFile = useRepositoryFileEditorOpenFile();
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  const resize = useCallback((width: number) => {
    setWidthPx(clampWorkspaceFileTreeRailWidthPx(width));
  }, []);
  const handleOpenFile = useCallback((path: string, options?: GitPanelOpenFileOptions) => {
    markPaneActive(paneIndex);
    openFile(path, { ...options, fileRootPath: repositoryPath, targetPaneIndex: paneIndex });
  }, [openFile, paneIndex, repositoryPath]);

  return (
    <div
      ref={setRootRef}
      className="app-claude-sessions__pane app-claude-sessions__pane--workspace"
      data-pane-index={paneIndex}
      onMouseDownCapture={() => markPaneActive(paneIndex)}
      onFocusCapture={() => markPaneActive(paneIndex)}
    >
      {cornerButton}
      {open && repositoryPath ? (
        <>
          <div className="app-pane-file-tree" style={{ width: displayedWidthPx }}>
            <WorkspaceFileTreeRail
              key={repositoryPath}
              widthPx={displayedWidthPx}
              repositoryPath={repositoryPath}
              repositoryName={repositoryName}
              onOpenFile={handleOpenFile}
              onClose={close}
            />
          </div>
          <MainLayoutResizeHandle variant="left" startWidthPx={displayedWidthPx} onWidthChange={resize} />
        </>
      ) : null}
      <div className="app-pane-workspace-content">
        {children({ fileTreeRailOpen: open, onToggleFileTree: toggle })}
      </div>
    </div>
  );
}
