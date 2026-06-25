import { memo, type ReactNode } from "react";

export type LeftSidebarBottomTabPanesProps = {
  showGit: boolean;
  showFiles: boolean;
  gitPane: ReactNode;
  filesPane: ReactNode;
  panelsReady: boolean;
};

/**
 * Git / 文件同栏保活：切换 Tab 时仅隐藏，避免卸载 GitPanel / 文件树导致反复重建。
 * 同栏上下分栏时文件树在上、Git 在下。
 */
export const LeftSidebarBottomTabPanes = memo(function LeftSidebarBottomTabPanes({
  showGit,
  showFiles,
  gitPane,
  filesPane,
  panelsReady,
}: LeftSidebarBottomTabPanesProps) {
  const isSplit = showGit && showFiles && panelsReady;

  if (!panelsReady) {
    return (
      <div className="app-left-sidebar-bottom-tab-content app-left-sidebar-bottom-tab-content--loading">
        {showGit ? gitPane : filesPane}
      </div>
    );
  }

  return (
    <div
      className={
        "app-left-sidebar-bottom-tab-content" +
        (isSplit ? " app-left-sidebar-bottom-tab-content--split" : "")
      }
    >
      {/* 上下分栏时文件树在上 */}
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (!showFiles ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={!showFiles ? true : undefined}
        aria-hidden={!showFiles}
      >
        {filesPane}
      </div>
      {/* 上下分栏时 Git 在下，限定最高 230px */}
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (!showGit ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={!showGit ? true : undefined}
        aria-hidden={!showGit}
      >
        {gitPane}
      </div>
    </div>
  );
});
