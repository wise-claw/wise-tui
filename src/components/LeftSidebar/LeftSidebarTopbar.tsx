import { Tooltip } from "antd";
import { ClaudeCodeUsageHeaderBtn } from "../ClaudeCodeUsagePopover";
import { ClaudeCodeToolsTopbarTrigger } from "../ClaudeSessions/ClaudeCodeToolsTopbarTrigger";
import { DefaultConfigTopbarTrigger } from "./DefaultConfigTopbarTrigger";
import { NewMainWindowTopbarTrigger } from "./NewMainWindowTopbarTrigger";
import { IconSettings } from "../icons/IconSettings";
import type { AuthorPane } from "../../types/viewMode";
import "./NewMainWindowTopbarTrigger.css";

interface LeftSidebarTopbarProps {
  authorDisabled?: boolean;
  authorTooltip?: string;
  activeRepositoryPath?: string;
  activeRepositoryId?: number | null;
  onOpenAuthor: (pane?: AuthorPane) => void;
}

export function LeftSidebarTopbar({
  authorDisabled = false,
  authorTooltip = "单仓不支持工作台配置；升格为工作区后启用",
  activeRepositoryPath,
  activeRepositoryId = null,
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
        <NewMainWindowTopbarTrigger activeRepositoryId={activeRepositoryId} />
        <DefaultConfigTopbarTrigger />
        <ClaudeCodeUsageHeaderBtn repositoryPath={activeRepositoryPath} />
        <ClaudeCodeToolsTopbarTrigger
          variant="sidebar"
          repositoryPath={activeRepositoryPath}
          onOpenAuthorConfig={authorDisabled ? undefined : onOpenAuthor}
        />
      </div>
    </div>
  );
}
