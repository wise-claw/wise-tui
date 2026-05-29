import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import {
  computeTodoProgress,
  pickActiveTodoTitle,
  truncateTodoTitle,
} from "../../../notifications";
import { DOCK_SPACING } from "./shared-styles";

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoDockProps {
  items: TodoItem[];
  onToggle: (id: string) => void;
  /** 清空并收起任务列表（不触发折叠行的展开/收起） */
  onClose?: () => void;
}

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return (
      <span className="app-todo-item__icon app-todo-item__icon--done" aria-hidden>
        ✓
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="app-todo-item__icon app-todo-item__icon--active" aria-hidden>
        ›
      </span>
    );
  }
  return <span className="app-todo-item__icon app-todo-item__icon--pending" aria-hidden />;
}

export function TodoDock({ items, onToggle, onClose }: TodoDockProps) {
  const [collapsed, setCollapsed] = useState(true);
  const prevProgressedRef = useRef(0);
  const prevCountRef = useRef(0);

  const { progressed, total, allCompleted } = computeTodoProgress(items);
  const progress = total > 0 ? progressed / total : 0;
  const activeTitle = pickActiveTodoTitle(items);
  const headerTitle = activeTitle ? truncateTodoTitle(activeTitle) : "任务列表";

  useEffect(() => {
    const prevProgressed = prevProgressedRef.current;
    const prevCount = prevCountRef.current;
    prevProgressedRef.current = progressed;
    prevCountRef.current = items.length;

    if (items.length === 0) {
      setCollapsed(true);
      return;
    }
    if (prevCount === 0 && items.length > 0) {
      setCollapsed(false);
      return;
    }
    if (progressed > prevProgressed) {
      setCollapsed(false);
    }
  }, [items.length, progressed]);

  useEffect(() => {
    if (!allCompleted || items.length === 0) return;
    const timer = window.setTimeout(() => setCollapsed(true), 2500);
    return () => window.clearTimeout(timer);
  }, [allCompleted, items.length]);

  if (items.length === 0) return null;

  return (
    <div className="app-claude-dock app-claude-dock--todo" style={{ marginBottom: DOCK_SPACING.tight }}>
      <div className="app-todo-head">
        <button
          type="button"
          className="app-todo-head__main"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span
            className="app-todo-head__progress"
            style={{ width: `${Math.round(progress * 100)}%` }}
            aria-hidden
          />
          <span className="app-todo-head__meta">
            <span className="app-todo-head__count">
              {progressed}/{total}
            </span>
            <span className="app-todo-head__title" title={activeTitle ?? undefined}>
              {headerTitle}
            </span>
          </span>
          <span className="app-todo-head__chevron" aria-hidden>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>
        {onClose ? (
          <Button
            type="text"
            size="small"
            title="关闭任务列表"
            aria-label="关闭任务列表"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="app-todo-head__close"
          >
            ×
          </Button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="app-todo-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-todo-item app-todo-item--${item.status}`}
              onClick={() => onToggle(item.id)}
            >
              <TodoStatusIcon status={item.status} />
              <span className="app-todo-item__text" title={item.content}>
                {item.content}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
