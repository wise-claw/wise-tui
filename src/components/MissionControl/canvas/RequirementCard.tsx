import { Select } from "antd";
import type { EngineeringDetailsVM, RequirementCardVM } from "../presenter/types";

interface RequirementCardProps {
  item: RequirementCardVM;
  taskGroups: EngineeringDetailsVM["clusters"];
  onSelect: (id: string) => void;
  onMoveRequirement: (requirementId: string, targetTaskGroupId: string) => void;
}

export function RequirementCard({ item, taskGroups, onSelect, onMoveRequirement }: RequirementCardProps) {
  const { title, summary } = splitRequirementPreview(item.bodyPreview);
  return (
    <button
      type="button"
      className={`mission-requirement-card${item.isHighlighted ? " mission-requirement-card--active" : ""}`}
      onClick={() => onSelect(item.id)}
    >
      <span className="mission-requirement-card__top">
        <span className="mission-requirement-card__id">{item.id}</span>
        <span className="mission-requirement-card__priority">P0 必做</span>
      </span>
      <span className="mission-requirement-card__title">{title}</span>
      {summary ? <span className="mission-requirement-card__body">{summary}</span> : null}
      <span className="mission-requirement-card__footer">
        <span>{item.taskCount > 0 ? `${item.taskCount} 个任务` : "等待拆解"}</span>
        {item.hasCrossGroupTasks ? <span className="mission-requirement-card__flag">跨组</span> : null}
      </span>
      {taskGroups.length > 1 ? (
        <span className="mission-requirement-card__move" onClick={(event) => event.stopPropagation()}>
          <Select<string>
            size="small"
            placeholder="移动到任务分组"
            value={undefined}
            onChange={(targetTaskGroupId) => {
              if (targetTaskGroupId) onMoveRequirement(item.id, targetTaskGroupId);
            }}
            options={taskGroups.map((group) => ({
              value: group.id,
              label: group.title,
              disabled: item.owningTaskGroupIds.length === 1 && item.owningTaskGroupIds[0] === group.id,
            }))}
          />
        </span>
      ) : null}
    </button>
  );
}

function splitRequirementPreview(preview: string): { title: string; summary: string } {
  const source = preview.trim();
  if (!source) return { title: "未命名需求", summary: "" };
  const firstBreak = source.search(/[。；;,.，]/);
  if (firstBreak > 0 && firstBreak <= 28) {
    return {
      title: source.slice(0, firstBreak + 1).trim(),
      summary: source.slice(firstBreak + 1).trim(),
    };
  }
  if (source.length <= 28) return { title: source, summary: "" };
  return {
    title: source.slice(0, 28).trim(),
    summary: source.slice(28).trim(),
  };
}
