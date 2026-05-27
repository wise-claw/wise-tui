import { Tooltip } from "antd";
import { GitBottomTabIcon, FilesBottomTabIcon } from "./SidebarIcons";
import type { LeftBottomTab } from "./sidebarStorage";

interface LeftSidebarBottomTabSwitcherProps {
  activeTab: LeftBottomTab;
  onChange: (tab: LeftBottomTab) => void;
}

export function LeftSidebarBottomTabSwitcher({
  activeTab,
  onChange,
}: LeftSidebarBottomTabSwitcherProps) {
  return (
    <div className="app-left-sidebar-repo-panel-tabs" role="tablist" aria-label="仓库面板">
      <Tooltip title="Git 变更" placement="topRight" mouseEnterDelay={0.2}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "git"}
          aria-label="Git"
          title="Git"
          className={
            "app-left-sidebar-repo-panel-tab" +
            (activeTab === "git" ? " app-left-sidebar-repo-panel-tab--active" : "")
          }
          onClick={() => onChange("git")}
        >
          <GitBottomTabIcon />
        </button>
      </Tooltip>
      <Tooltip title="仓库文件树" mouseEnterDelay={0.2}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "files"}
          aria-label="文件"
          title="文件"
          className={
            "app-left-sidebar-repo-panel-tab" +
            (activeTab === "files" ? " app-left-sidebar-repo-panel-tab--active" : "")
          }
          onClick={() => onChange("files")}
        >
          <FilesBottomTabIcon />
        </button>
      </Tooltip>
    </div>
  );
}
