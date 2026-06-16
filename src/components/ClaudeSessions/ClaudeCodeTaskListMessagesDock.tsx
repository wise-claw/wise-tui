import { memo } from "react";
import type { TodoItem } from "../../types";
import { useTodoListCollapse } from "../../hooks/useTodoListCollapse";
import { ClaudeCodeTaskListStatus } from "../ClaudeChatInput/dock/claude-code-task-list-status";

interface Props {
  items: TodoItem[];
  sessionStartedAt: number;
  estimatedTokens: number;
}

export const ClaudeCodeTaskListMessagesDock = memo(function ClaudeCodeTaskListMessagesDock({
  items,
  sessionStartedAt,
  estimatedTokens,
}: Props) {
  const { collapsed, setCollapsed } = useTodoListCollapse(items, { autoCollapseDelayMs: 4000 });

  return (
    <div className="app-cc-task-list-anchor">
      <ClaudeCodeTaskListStatus
        items={items}
        sessionStartedAt={sessionStartedAt}
        estimatedTokens={estimatedTokens}
        variant="messages"
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
    </div>
  );
});
