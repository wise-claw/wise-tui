import { Input } from "antd";
import { useMemo, useState } from "react";
import type { MonitorCompletedTaskItem, MonitorDrawerTarget } from "../../types";
import "../ProgressMonitorPanel/index.css";

interface Props {
  completedTasks: MonitorCompletedTaskItem[];
  activeTarget?: MonitorDrawerTarget | null;
  onOpenTaskDetail: (taskId: string) => void;
}

export function CompletedTaskPanel({
  completedTasks,
  activeTarget,
  onOpenTaskDetail,
}: Props) {
  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"all" | "completed" | "rejected" | "archived">("all");

  const filteredCompletedTasks = useMemo(() => {
    const keyword = taskKeyword.trim().toLowerCase();
    return completedTasks.filter((item) => {
      if (taskStatusFilter !== "all" && item.status !== taskStatusFilter) return false;
      if (!keyword) return true;
      const searchText = `${item.title} ${item.workflowName}`.toLowerCase();
      return searchText.includes(keyword);
    });
  }, [completedTasks, taskKeyword, taskStatusFilter]);

  return (
    <div className="app-monitor-panel app-completed-task-panel">
      <div className="app-monitor-panel__head">
        <div className="app-monitor-panel__title">完成任务</div>
        <div className="app-monitor-panel__meta">最近 {filteredCompletedTasks.length} 条</div>
      </div>
      <div className="app-monitor-panel__section">
        <Input
          size="small"
          allowClear
          value={taskKeyword}
          onChange={(event) => setTaskKeyword(event.target.value)}
          placeholder="搜索任务名称"
          className="app-monitor-panel__task-search"
        />
        <div className="app-monitor-panel__task-status-filters">
          {([
            { id: "all", label: "全部" },
            { id: "completed", label: "完成" },
            { id: "rejected", label: "驳回" },
            { id: "archived", label: "归档" },
          ] as const).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-monitor-panel__filter-btn ${taskStatusFilter === item.id ? "app-monitor-panel__filter-btn--active" : ""}`}
              onClick={() => setTaskStatusFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {filteredCompletedTasks.length === 0 ? (
          <div className="app-monitor-panel__empty">暂无完成任务</div>
        ) : (
          filteredCompletedTasks.slice(0, 30).map((item) => (
            <div
              key={item.taskId}
              className={`app-monitor-panel__item ${activeTarget?.type === "task" && activeTarget.taskId === item.taskId ? "app-monitor-panel__item--active" : ""}`}
              onClick={() => onOpenTaskDetail(item.taskId)}
            >
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name">{item.title}</span>
                <span className="app-monitor-panel__status-pill app-monitor-panel__status-pill--idle">
                  {item.status === "completed" ? "已完成" : item.status === "rejected" ? "已驳回" : "已归档"}
                </span>
              </div>
              <div className="app-monitor-panel__item-sub">{item.workflowName}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
