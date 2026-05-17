import { Tooltip } from "antd";
import { ClaudeCodeUsageHeaderBtn } from "../ClaudeCodeUsagePopover";
import { IconSettings } from "../icons/IconSettings";
import { IconCompactLayout } from "./SidebarIcons";

interface LeftSidebarTopbarProps {
  compactLayoutMode: boolean;
  onToggleCompactLayoutMode?: () => void;
  authorDisabled?: boolean;
  authorTooltip?: string;
  onOpenAuthor: () => void;
  onOpenSettings: () => void;
}

export function LeftSidebarTopbar({
  compactLayoutMode,
  onToggleCompactLayoutMode,
  authorDisabled = false,
  authorTooltip = "Author：Workspace、Agents、Workflows、MCP、Skills、Hooks、Prompts、Trellis Spec",
  onOpenAuthor,
  onOpenSettings,
}: LeftSidebarTopbarProps) {
  return (
    <div className="app-left-sidebar-topbar">
      <div className="app-left-sidebar-topbar-drag app-logo-draggable" data-tauri-drag-region aria-hidden />
      <div className="app-left-sidebar-topbar-actions">
        <Tooltip title={authorDisabled ? authorTooltip : "Author：配置 Workspace、Agents、Workflows、MCP、Skills、Hooks、Prompts、Trellis Spec"} mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-left-sidebar-compact-btn"
            aria-label="打开 Author"
            disabled={authorDisabled}
            onClick={onOpenAuthor}
          >
            <IconSettings />
          </button>
        </Tooltip>
        <Tooltip title="设置：钉钉机器人、快捷键、Claude 沙箱与权限" mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-left-sidebar-compact-btn"
            aria-label="打开设置"
            onClick={onOpenSettings}
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
              className={`app-left-sidebar-compact-btn${compactLayoutMode ? " app-left-sidebar-compact-btn--active" : ""}`}
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
