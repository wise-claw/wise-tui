import { Tooltip } from "antd";
import { ClaudeCodeUsageHeaderBtn } from "../ClaudeCodeUsagePopover";
import { IconSettings } from "../icons/IconSettings";
import { IconCompactLayout } from "./SidebarIcons";
import type { AuthorPane } from "../../types/viewMode";

interface LeftSidebarTopbarProps {
  compactLayoutMode: boolean;
  onToggleCompactLayoutMode?: () => void;
  authorDisabled?: boolean;
  authorTooltip?: string;
  onOpenAuthor: (pane?: AuthorPane) => void;
}

export function LeftSidebarTopbar({
  compactLayoutMode,
  onToggleCompactLayoutMode,
  authorDisabled = false,
  authorTooltip = "单仓不支持工作台配置；升格为工作区后启用",
  onOpenAuthor,
}: LeftSidebarTopbarProps) {
  return (
    <div className="app-left-sidebar-topbar">
      <div className="app-left-sidebar-topbar-brand app-logo-draggable" data-tauri-drag-region>
        <span className="app-left-sidebar-topbar-mark" aria-hidden>
          W
        </span>
      </div>
      <div className="app-left-sidebar-topbar-actions">
        <Tooltip title={authorDisabled ? authorTooltip : "工作台配置"} mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-left-sidebar-topbar-btn"
            aria-label="打开工作台配置"
            disabled={authorDisabled}
            onClick={() => onOpenAuthor()}
          >
            <IconSettings />
          </button>
        </Tooltip>
        {onToggleCompactLayoutMode ? (
          <Tooltip
            title={
              compactLayoutMode
                ? "退出小窗口模式（⌥S）"
                : "小窗口模式（收起右栏，窗口 700×600，快捷键 ⌥S）"
            }
            mouseEnterDelay={0.35}
          >
            <button
              type="button"
              className={`app-left-sidebar-topbar-btn${compactLayoutMode ? " app-left-sidebar-topbar-btn--active" : ""}`}
              aria-label={compactLayoutMode ? "退出小窗口模式" : "小窗口模式"}
              onClick={onToggleCompactLayoutMode}
            >
              <IconCompactLayout />
            </button>
          </Tooltip>
        ) : null}
        <ClaudeCodeUsageHeaderBtn />
      </div>
    </div>
  );
}
