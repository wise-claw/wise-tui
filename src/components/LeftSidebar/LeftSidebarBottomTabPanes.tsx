import { memo, type ReactNode } from "react";
import type { LeftBottomTab } from "./sidebarStorage";

export type LeftSidebarBottomTabPanesProps = {
  activeTab: LeftBottomTab;
  gitPane: ReactNode;
  filesPane: ReactNode;
  panelsReady: boolean;
};

/**
 * Git / 文件双栏保活：切换 Tab 时仅隐藏，避免卸载 GitPanel / 文件树导致反复重建。
 */
export const LeftSidebarBottomTabPanes = memo(function LeftSidebarBottomTabPanes({
  activeTab,
  gitPane,
  filesPane,
  panelsReady,
}: LeftSidebarBottomTabPanesProps) {
  if (!panelsReady) {
    return (
      <div className="app-left-sidebar-bottom-tab-content app-left-sidebar-bottom-tab-content--loading">
        {activeTab === "git" ? gitPane : filesPane}
      </div>
    );
  }

  return (
    <div className="app-left-sidebar-bottom-tab-content">
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (activeTab !== "git" ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={activeTab !== "git" ? true : undefined}
        aria-hidden={activeTab !== "git"}
      >
        {gitPane}
      </div>
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (activeTab !== "files" ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={activeTab !== "files" ? true : undefined}
        aria-hidden={activeTab !== "files"}
      >
        {filesPane}
      </div>
    </div>
  );
});
