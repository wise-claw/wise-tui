import { Tag } from "antd";
import type { SwimlaneVM } from "../presenter/types";
import { TaskCard } from "./TaskCard";

interface TaskSwimlaneLayerProps {
  lane: SwimlaneVM;
  onSelectTask: (taskId: string) => void;
}

export function TaskSwimlaneLayer({ lane, onSelectTask }: TaskSwimlaneLayerProps) {
  return (
    <div className={`mission-swimlane-layer ${lane.isParallel ? "mission-swimlane-layer--parallel" : ""} ${lane.isBottleneck ? "mission-swimlane-layer--bottleneck" : ""}`}>
      <div className="mission-swimlane-layer__header">
        <span className="mission-swimlane-layer__label">{lane.label}</span>
        {lane.isBottleneck ? <Tag color="red">瓶颈</Tag> : null}
      </div>
      <div className="mission-swimlane-layer__cards">
        {lane.tasks.map((task) => (
          <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
        ))}
      </div>
    </div>
  );
}
