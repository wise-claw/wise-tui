import { LinkOutlined, TagOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import type { TaskCardVM } from "../presenter/types";
import { ROLE_LABEL } from "../copy";

interface TaskCardProps {
  task: TaskCardVM;
  onSelect: (taskId: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "default" };

export function TaskCard({ task, onSelect }: TaskCardProps) {
  return (
    <button
      type="button"
      className={[
        "mission-task-card",
        task.isSelected ? "mission-task-card--selected" : "",
        task.isHighlighted ? "mission-task-card--highlighted" : "",
        task.isDimmed ? "mission-task-card--dimmed" : "",
        task.isPlaceholder ? "mission-task-card--placeholder" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(task.id)}
    >
      <span className="mission-task-card__topline">
        <span className="mission-task-card__id">{task.id}</span>
        <span className={`mission-status mission-status--${task.status}`}>
          <i />
          {task.statusLabel}
        </span>
      </span>
      <span className="mission-task-card__title">{task.title}</span>
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
      {task.prdAnchorTags.length > 0 ? (
        <span className="mission-task-card__anchors">
          <TagOutlined />
          {task.prdAnchorTags.slice(0, 3).map((tag, idx) => (
            <span key={idx} className="mission-anchor-tag">{tag}</span>
          ))}
        </span>
      ) : null}
      {task.agentStatus ? (
        <span className="mission-task-card__agent">
          <Tag
            color={task.agentStatus.status === "running" ? "processing" : task.agentStatus.status === "done" ? "success" : task.agentStatus.status === "blocked" ? "error" : "default"}
            style={{ fontSize: 10, lineHeight: "16px" }}
          >
            {task.agentStatus.agentName} · {task.agentStatus.stageLabel}
          </Tag>
        </span>
      ) : null}
      <span className="mission-task-card__links">
        <LinkOutlined />
        {task.sourceRequirementIds.slice(0, 3).map((id) => (
          <span key={id}>{id}</span>
        ))}
        {task.sourceRequirementIds.length > 3 ? <span>+{task.sourceRequirementIds.length - 3}</span> : null}
      </span>
    </button>
  );
}
