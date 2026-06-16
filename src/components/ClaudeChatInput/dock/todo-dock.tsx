import { useTodoListCollapse } from "../../../hooks/useTodoListCollapse";
import { ClaudeCodeTaskListStatus } from "./claude-code-task-list-status";

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoDockProps {
  items: TodoItem[];
  sessionStartedAt?: number;
  estimatedTokens?: number | null;
  hidden?: boolean;
  onToggle: (id: string) => void;
  /** 清空并收起任务列表（不触发折叠行的展开/收起） */
  onClose?: () => void;
}

export function TodoDock({
  items,
  sessionStartedAt,
  estimatedTokens,
  hidden = false,
  onToggle,
  onClose,
}: TodoDockProps) {
  const { collapsed, setCollapsed } = useTodoListCollapse(items);

  if (hidden || items.length === 0) return null;

  return (
    <div className="app-claude-dock app-claude-dock--todo">
      <ClaudeCodeTaskListStatus
        items={items}
        sessionStartedAt={sessionStartedAt}
        estimatedTokens={estimatedTokens}
        variant="composer"
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onToggleItem={onToggle}
        onClose={onClose}
      />
    </div>
  );
}
