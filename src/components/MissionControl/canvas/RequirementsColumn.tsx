import { Empty } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import { COPY } from "../copy";
import type { EngineeringDetailsVM, RequirementCardVM } from "../presenter/types";
import { RequirementCard } from "./RequirementCard";

interface RequirementsColumnProps {
  requirements: RequirementCardVM[];
  taskGroups: EngineeringDetailsVM["clusters"];
  onSelectRequirement: (id: string) => void;
  onMoveRequirement: (requirementId: string, targetTaskGroupId: string) => void;
}

export function RequirementsColumn({
  requirements,
  taskGroups,
  onSelectRequirement,
  onMoveRequirement,
}: RequirementsColumnProps) {
  return (
    <section className="mission-column mission-column--requirements">
      <div className="mission-column__header">
        <span className="mission-column__title">
          <FileTextOutlined />
          {COPY.columns.requirements}
        </span>
        <span className="mission-column__count">{requirements.length} 条</span>
      </div>
      <div className="mission-column__scroll">
        {requirements.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待 PRD" />
        ) : (
          requirements.map((requirement) => (
          <RequirementCard
            key={requirement.id}
            item={requirement}
            taskGroups={taskGroups}
            onSelect={onSelectRequirement}
            onMoveRequirement={onMoveRequirement}
          />
        ))
      )}
      </div>
    </section>
  );
}
