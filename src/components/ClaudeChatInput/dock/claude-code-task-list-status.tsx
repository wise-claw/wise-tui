import { useEffect, useMemo, useState } from "react";
import { Button } from "antd";
import type { TodoItem } from "../../../types";
import {
  buildTaskListDisplayModel,
  formatTaskListOverflowLabel,
  type TaskListTreeRow,
} from "../../../utils/claudeCodeTaskListDisplay";

export interface ClaudeCodeTaskListStatusProps {
  items: TodoItem[];
  sessionStartedAt?: number;
  estimatedTokens?: number | null;
  variant?: "composer" | "messages";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onToggleItem?: (id: string) => void;
  onClose?: () => void;
}

function TaskTreeStatusIcon({ status }: { status: TaskListTreeRow["status"] }) {
  if (status === "completed") {
    return (
      <span className="app-cc-task-list__icon app-cc-task-list__icon--done" aria-hidden>
        ✓
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="app-cc-task-list__icon app-cc-task-list__icon--active" aria-hidden>
        ■
      </span>
    );
  }
  return <span className="app-cc-task-list__icon app-cc-task-list__icon--pending" aria-hidden />;
}

export function ClaudeCodeTaskListStatus({
  items,
  sessionStartedAt,
  estimatedTokens,
  variant = "composer",
  collapsed: collapsedProp,
  onCollapsedChange,
  onToggleItem,
  onClose,
}: ClaudeCodeTaskListStatusProps) {
  const [collapsedInternal, setCollapsedInternal] = useState(false);
  const collapsed = collapsedProp ?? collapsedInternal;
  const setCollapsed = onCollapsedChange ?? setCollapsedInternal;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // 仅用于时长显示的每秒刷新。后台标签页（不可见）时暂停 interval，避免无意义重渲染
    // 与 buildTaskListDisplayModel 重算；回到前台立即刷新一次并恢复。与项目其他定时器
    // （DingTalk/Channels 等的可见性门控）保持一致。
    let timer: number | undefined;
    const tick = () => setNowMs(Date.now());
    const start = () => {
      if (timer !== undefined) return;
      tick();
      timer = window.setInterval(tick, 1000);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState !== "visible") {
      stop();
    } else {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  const model = useMemo(
    () =>
      buildTaskListDisplayModel(items, {
        sessionStartedAt,
        estimatedTokens,
        maxVisibleRows: 5,
        compact: collapsed,
        nowMs,
      }),
    [collapsed, estimatedTokens, items, nowMs, sessionStartedAt],
  );

  if (!model) return null;

  const metaParts = [
    model.progressLabel,
    model.metaDuration,
    model.metaTokens ? `↑ ${model.metaTokens}` : null,
  ].filter(Boolean);
  const overflowLabel = formatTaskListOverflowLabel(model.hiddenCompletedCount);

  return (
    <div
      className={[
        "app-cc-task-list",
        variant === "messages" ? "app-cc-task-list--messages" : "app-cc-task-list--composer",
        collapsed ? "app-cc-task-list--collapsed" : "app-cc-task-list--expanded",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-label="Claude Code 任务列表"
    >
      <div className="app-cc-task-list__head">
        <button
          type="button"
          className="app-cc-task-list__head-main"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <span className="app-cc-task-list__head-prefix" aria-hidden>
            *
          </span>
          <span className="app-cc-task-list__head-title" title={model.headerTitle}>
            {model.headerTitle}
          </span>
          {metaParts.length > 0 ? (
            <span className="app-cc-task-list__head-meta">({metaParts.join(" · ")})</span>
          ) : null}
          <span className="app-cc-task-list__head-chevron" aria-hidden>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>
        {onClose ? (
          <Button
            type="text"
            size="small"
            title="关闭任务列表"
            aria-label="关闭任务列表"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="app-cc-task-list__close"
          >
            ×
          </Button>
        ) : null}
      </div>

      {model.rows.length > 0 || overflowLabel ? (
        <div className="app-cc-task-list__tree">
          {model.rows.map((row) => (
            <div key={row.id} className={`app-cc-task-list__row app-cc-task-list__row--${row.status}`}>
              <span className="app-cc-task-list__branch" aria-hidden>
                |_
              </span>
              {onToggleItem ? (
                <button type="button" className="app-cc-task-list__row-btn" onClick={() => onToggleItem(row.id)}>
                  <TaskTreeStatusIcon status={row.status} />
                  <span className="app-cc-task-list__row-text" title={row.content}>
                    {row.content}
                  </span>
                </button>
              ) : (
                <div className="app-cc-task-list__row-body">
                  <TaskTreeStatusIcon status={row.status} />
                  <span className="app-cc-task-list__row-text" title={row.content}>
                    {row.content}
                  </span>
                </div>
              )}
            </div>
          ))}
          {overflowLabel ? <div className="app-cc-task-list__overflow">{overflowLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
