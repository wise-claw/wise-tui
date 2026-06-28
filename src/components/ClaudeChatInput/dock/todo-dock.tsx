import { useEffect, useRef, useState } from "react";
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
}

export function TodoDock({
  items,
  sessionStartedAt,
  estimatedTokens,
  hidden = false,
  onToggle,
}: TodoDockProps) {
  const { collapsed, setCollapsed } = useTodoListCollapse(items);
  const [dismissed, setDismissed] = useState(false);
  const prevItemsLengthRef = useRef(items.length);

  // 新 todo 写入时自动取消关闭状态，重新显示
  useEffect(() => {
    if (items.length > prevItemsLengthRef.current) {
      setDismissed(false);
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length]);

  // 全部清空时重置关闭状态
  useEffect(() => {
    if (items.length === 0) {
      setDismissed(false);
    }
  }, [items.length]);

  if (hidden || items.length === 0 || dismissed) return null;

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
        onClose={() => setDismissed(true)}
      />
    </div>
  );
}
