import { Tag } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import type { SwimlaneVM } from "../presenter/types";
import { TaskCard } from "./TaskCard";

interface TaskSwimlaneLayerProps {
  lane: SwimlaneVM;
  onSelectTask: (taskId: string) => void;
  onHoverTask: (taskId: string | null) => void;
  onRemoveDependency?: (taskId: string, depTaskId: string) => void;
  onRetryCluster?: (clusterId: string) => void;
}

export function TaskSwimlaneLayer({ lane, onSelectTask, onHoverTask, onRemoveDependency, onRetryCluster }: TaskSwimlaneLayerProps) {
  const layerClass = [
    "mission-swimlane-layer",
    lane.isParallel ? "mission-swimlane-layer--parallel" : "",
    lane.isBottleneck ? "mission-swimlane-layer--bottleneck" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={layerClass}>
      <div className="mission-swimlane-layer__header">
        {lane.isParallel ? (
          <span className="mission-swimlane-layer__group-badge">
            <ThunderboltOutlined />
            {lane.groupLabel}
          </span>
        ) : null}
        <span className="mission-swimlane-layer__label">{lane.label}</span>
        {lane.isBottleneck ? <Tag color="red">瓶颈</Tag> : null}
      </div>
      <div className="mission-swimlane-layer__cards">
        {lane.tasks.map((task) => (
          <TaskCard key={task.id} task={task} onSelect={onSelectTask} onHover={onHoverTask} onRemoveDependency={onRemoveDependency} onRetryCluster={onRetryCluster} />
        ))}
      </div>
    </div>
  );
}
