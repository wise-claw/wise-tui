import type { ParallelLayerVM } from "../presenter/types";
import { TaskCard } from "./TaskCard";

interface ParallelLayerBlockProps {
  layer: ParallelLayerVM;
  onSelectTask: (taskId: string) => void;
}

export function ParallelLayerBlock({ layer, onSelectTask }: ParallelLayerBlockProps) {
  return (
    <div
      className={[
        "mission-layer",
        layer.isParallel ? "mission-layer--parallel" : "mission-layer--single",
        layer.isBottleneck ? "mission-layer--bottleneck" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="mission-layer__title">
        <span>{layer.isParallel ? `并行组 ${toLayerName(layer.index)}` : `阶段 ${layer.index}`}</span>
        <span className="mission-layer__badge">
          {layer.isParallel ? `${layer.tasks.length} 个任务可并行` : "依赖就绪"}
        </span>
        {layer.isBottleneck ? <span className="mission-layer__risk">瓶颈</span> : null}
      </div>
      <div className="mission-layer__tasks">
        {layer.tasks.map((task) => (
          <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
        ))}
      </div>
    </div>
  );
}

function toLayerName(index: number): string {
  return String.fromCharCode(64 + Math.min(Math.max(index, 1), 26));
}
