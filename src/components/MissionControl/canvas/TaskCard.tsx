import { LinkOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import type { TaskCardVM } from "../presenter/types";
import { ROLE_LABEL } from "../copy";

interface TaskCardProps {
  task: TaskCardVM;
  onSelect: (taskId: string) => void;
  onHover: (taskId: string | null) => void;
  onRemoveDependency?: (taskId: string, depTaskId: string) => void;
  onRetryCluster?: (clusterId: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "default" };

export function TaskCard({ task, onSelect, onHover, onRemoveDependency, onRetryCluster }: TaskCardProps) {
  const hasDeps = task.dependencyLabels.length > 0;
  const blockedDeps = task.dependencyLabels.filter((d) => !d.satisfied);
  const satisfiedDeps = task.dependencyLabels.filter((d) => d.satisfied);
  const editableDepIds = new Set(task.editableDependencyTaskIds);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(task.id);
  };

  return (
    <article
      role="button"
      tabIndex={0}
      className={[
        "mission-task-card",
        task.isSelected ? "mission-task-card--selected" : "",
        task.isHighlighted ? "mission-task-card--highlighted" : "",
        task.isDimmed ? "mission-task-card--dimmed" : "",
        task.isPlaceholder ? "mission-task-card--placeholder" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(task.id)}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Status indicator dot + ID */}
      <span className="mission-task-card__topline">
        <span className="mission-task-card__id">{task.id}</span>
        <span className={`mission-status mission-status--${task.status}`}>
          <i />
          {task.statusLabel}
        </span>
      </span>

      {/* Title */}
      <span className="mission-task-card__title">{task.title}</span>

      {/* Tags: priority, role, repo */}
      <span className="mission-task-card__tags">
        {task.priority ? (
          <Tag color={PRIORITY_COLORS[task.priority]} style={{ fontSize: 10, lineHeight: "16px" }}>
            {task.priority}
          </Tag>
        ) : null}
        {task.role ? (
          <Tag style={{ fontSize: 10, lineHeight: "16px" }}>{ROLE_LABEL[task.role]}</Tag>
        ) : null}
        {task.repositoryLabel ? (
          <Tag style={{ fontSize: 10, lineHeight: "16px" }}>{task.repositoryLabel}</Tag>
        ) : null}
      </span>

      {/* PRD anchors */}
      {task.prdAnchorTags.length > 0 ? (
        <span className="mission-task-card__anchors">
          {task.prdAnchorTags.slice(0, 3).map((tag, idx) => (
            <span key={idx} className="mission-anchor-tag">{tag}</span>
          ))}
        </span>
      ) : null}

      {/* Dependency blockers — click to cut */}
      {hasDeps ? (
        <span className="mission-task-card__deps">
          {blockedDeps.map((d) => (
            <button
              key={d.taskId}
              type="button"
              className="mission-dep-tag mission-dep-tag--blocker"
              aria-disabled={!editableDepIds.has(d.taskId)}
              title={editableDepIds.has(d.taskId) ? "点击剪断此依赖" : "这是任务分组依赖，请在工程设置里调整"}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDependency?.(task.id, d.taskId);
              }}
            >
              ⛔ 依赖 {d.title}
            </button>
          ))}
          {satisfiedDeps.map((d) => (
            <button
              key={d.taskId}
              type="button"
              className="mission-dep-tag mission-dep-tag--waiting"
              aria-disabled={!editableDepIds.has(d.taskId)}
              title={editableDepIds.has(d.taskId) ? "点击剪断此依赖" : "这是任务分组依赖，请在工程设置里调整"}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDependency?.(task.id, d.taskId);
              }}
            >
              等待 {d.title}
            </button>
          ))}
        </span>
      ) : null}

      {/* Agent status + controls */}
      {task.agentStatus || task.status === "blocked" ? (
        <span className="mission-task-card__controls">
          {task.agentStatus ? (
            <Tag
              color={task.agentStatus.status === "running" ? "processing" : task.agentStatus.status === "done" ? "success" : task.agentStatus.status === "blocked" ? "error" : "default"}
              style={{ fontSize: 10, lineHeight: "16px" }}
            >
              {task.agentStatus.agentName} · {task.agentStatus.stageLabel}
            </Tag>
          ) : null}
          {task.status === "blocked" && onRetryCluster ? (
            <button
              type="button"
              className="mission-agent-btn mission-agent-btn--retry"
              title="重新派发此集群"
              onClick={(e) => {
                e.stopPropagation();
                onRetryCluster(task.clusterId);
              }}
            >
              🔄 重试
            </button>
          ) : null}
        </span>
      ) : null}

      {/* Source requirement links */}
      <span className="mission-task-card__links">
        <LinkOutlined />
        {task.sourceRequirementIds.slice(0, 3).map((id) => (
          <span key={id}>{id}</span>
        ))}
        {task.sourceRequirementIds.length > 3 ? <span>+{task.sourceRequirementIds.length - 3}</span> : null}
      </span>
    </article>
  );
}
