import { Empty } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";
import { COPY } from "../copy";
import type { SwimlaneVM } from "../presenter/types";
import { DependencyConnector } from "./DependencyConnector";
import { TaskSwimlaneLayer } from "./TaskSwimlaneLayer";
import { SwimlaneLegend } from "./SwimlaneLegend";

interface TaskSwimlaneProps {
  swimlane: SwimlaneVM[];
  hasHighlightedPath: boolean;
  onSelectTask: (taskId: string) => void;
  onHoverTask: (taskId: string | null) => void;
  onRemoveDependency?: (taskId: string, depTaskId: string) => void;
  onRetryCluster?: (clusterId: string) => void;
}

export function TaskSwimlane({ swimlane, hasHighlightedPath, onSelectTask, onHoverTask, onRemoveDependency, onRetryCluster }: TaskSwimlaneProps) {
  const taskCount = swimlane.reduce((sum, lane) => sum + lane.tasks.length, 0);
  const parallelCount = swimlane.filter((lane) => lane.isParallel).length;

  return (
    <section className="mission-column mission-column--swimlane">
      <div className="mission-column__header">
        <span className="mission-column__title">
          <ApartmentOutlined />
          {COPY.columns.graph}
        </span>
        <span className="mission-column__hint">
          {parallelCount > 0 ? `${parallelCount} 组可并行` : `${taskCount} 个任务`}
        </span>
      </div>
      <div className="mission-column__scroll mission-column__scroll--swimlane">
        {swimlane.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待任务规划" />
        ) : (
          swimlane.map((lane, index) => (
            <div key={lane.id} className="mission-swimlane-wrap">
              {index > 0 ? <DependencyConnector active={hasHighlightedPath} /> : null}
              <TaskSwimlaneLayer lane={lane} onSelectTask={onSelectTask} onHoverTask={onHoverTask} onRemoveDependency={onRemoveDependency} onRetryCluster={onRetryCluster} />
            </div>
          ))
        )}
      </div>
      {swimlane.length > 0 ? <SwimlaneLegend swimlane={swimlane} /> : null}
    </section>
  );
}
