import { Popover } from "antd";
import { Suspense, lazy, useCallback, useState } from "react";
import { IconClaudeCodeMascot } from "../icons/IconClaudeCodeMascot";
import "./ClaudeCodeToolsTopbarTrigger.css";

const ClaudeCodeToolsPanel = lazy(() =>
  import("../ClaudeCodeToolsPanel").then((module) => ({ default: module.ClaudeCodeToolsPanel })),
);

interface Props {
  repositoryPath?: string;
  variant?: "chat" | "sidebar";
}

export function ClaudeCodeToolsTopbarTrigger({ repositoryPath, variant = "chat" }: Props) {
  const [open, setOpen] = useState(false);
  const isSidebar = variant === "sidebar";

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

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
          />
        </Suspense>
      }
    >
      <button
        type="button"
        className={
          (isSidebar ? "app-left-sidebar-topbar-btn" : "app-topbar-btn") +
          " app-claude-code-tools-topbar-btn" +
          (open ? (isSidebar ? " app-left-sidebar-topbar-btn--active" : " active") : "")
        }
        aria-label="Claude Code 工具"
        aria-expanded={open}
        title="Claude Code（MCP、技能、Hooks、子代理）"
      >
        <IconClaudeCodeMascot />
      </button>
    </Popover>
  );
}
