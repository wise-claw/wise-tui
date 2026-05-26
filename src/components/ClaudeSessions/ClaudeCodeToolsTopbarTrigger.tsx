import { Popover } from "antd";
import { Suspense, lazy, useCallback, useState } from "react";
import { IconClaudeCodeMascot } from "../icons/IconClaudeCodeMascot";
import "./ClaudeCodeToolsTopbarTrigger.css";

const ClaudeCodeToolsPanel = lazy(() =>
  import("../ClaudeCodeToolsPanel").then((module) => ({ default: module.ClaudeCodeToolsPanel })),
);

interface Props {
  repositoryPath?: string;
}

export function ClaudeCodeToolsTopbarTrigger({ repositoryPath }: Props) {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
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
        className={"app-topbar-btn app-claude-code-tools-topbar-btn" + (open ? " active" : "")}
        aria-label="Claude Code 工具"
        aria-expanded={open}
        title="Claude Code（MCP、技能、Hooks、子代理）"
      >
        <IconClaudeCodeMascot />
      </button>
    </Popover>
  );
}
