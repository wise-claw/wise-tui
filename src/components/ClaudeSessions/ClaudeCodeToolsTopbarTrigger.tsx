import { Popover, Tooltip } from "antd";
import { Suspense, lazy, useCallback, useState } from "react";
import type { AuthorPane } from "../../types/viewMode";
import { IconClaudeCodeMascot } from "../icons/IconClaudeCodeMascot";
import "./ClaudeCodeToolsTopbarTrigger.css";

const ClaudeCodeToolsPanel = lazy(() =>
  import("../ClaudeCodeToolsPanel").then((module) => ({ default: module.ClaudeCodeToolsPanel })),
);

interface Props {
  repositoryPath?: string;
  variant?: "chat" | "sidebar";
  /** 打开工作台配置中与本 Tab 对应的页面 */
  onOpenAuthorConfig?: (pane: AuthorPane) => void;
}

export function ClaudeCodeToolsTopbarTrigger({
  repositoryPath,
  variant = "chat",
  onOpenAuthorConfig,
}: Props) {
  const [open, setOpen] = useState(false);
  const isSidebar = variant === "sidebar";

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const handleOpenAuthorConfig = useCallback(
    (pane: AuthorPane) => {
      setOpen(false);
      onOpenAuthorConfig?.(pane);
    },
    [onOpenAuthorConfig],
  );

  return (
    <Popover
      trigger="click"
      placement={isSidebar ? "bottomRight" : "bottomRight"}
      open={open}
      onOpenChange={handleOpenChange}
      destroyOnHidden={false}
      overlayClassName="app-claude-code-tools-topbar-popover"
      content={
        <Suspense fallback={<div className="app-claude-code-tools-topbar-popover-loading">加载中…</div>}>
          <ClaudeCodeToolsPanel
            repositoryPath={repositoryPath}
            variant="popover"
            surfaceActive={open}
            onOpenAuthorConfig={onOpenAuthorConfig ? handleOpenAuthorConfig : undefined}
          />
        </Suspense>
      }
    >
      {isSidebar ? (
        <Tooltip title="Claude Code（MCP、技能、Hooks、子代理）" mouseEnterDelay={0.35}>
          <button
            type="button"
            className={
              "app-left-sidebar-topbar-btn app-claude-code-tools-topbar-btn" +
              (open ? " app-left-sidebar-topbar-btn--active" : "")
            }
            aria-label="Claude Code 工具"
            aria-expanded={open}
          >
            <IconClaudeCodeMascot />
          </button>
        </Tooltip>
      ) : (
        <Tooltip title="Claude Code（MCP、技能、Hooks、子代理）" mouseEnterDelay={0.35}>
          <button
            type="button"
            className={
              "app-topbar-btn app-claude-code-tools-topbar-btn" + (open ? " active" : "")
            }
            aria-label="Claude Code 工具"
            aria-expanded={open}
          >
            <IconClaudeCodeMascot />
          </button>
        </Tooltip>
      )}
    </Popover>
  );
}
