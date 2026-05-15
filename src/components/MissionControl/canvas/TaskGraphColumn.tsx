import { Empty } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";
import { COPY } from "../copy";
import type { MissionViewModel } from "../presenter/types";
import { DependencyConnector } from "./DependencyConnector";
import { ParallelLayerBlock } from "./ParallelLayerBlock";

interface TaskGraphColumnProps {
  taskGraph: MissionViewModel["taskGraph"];
  hasHighlightedPath: boolean;
  onSelectTask: (taskId: string) => void;
}

export function TaskGraphColumn({ taskGraph, hasHighlightedPath, onSelectTask }: TaskGraphColumnProps) {
  const taskCount = taskGraph.layers.reduce((sum, layer) => sum + layer.tasks.length, 0);
  const parallelCount = taskGraph.layers.filter((layer) => layer.isParallel).length;
  return (
    <section className="mission-column mission-column--graph">
      <div className="mission-column__header">
        <span className="mission-column__title">
          <ApartmentOutlined />
          {COPY.columns.graph}
        </span>
        <span className="mission-column__hint">
          {parallelCount > 0 ? `${parallelCount} 组可并行` : `${taskCount} 个任务`}
        </span>
      </div>
      <div className="mission-column__scroll mission-column__scroll--graph">
        {taskGraph.layers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待任务规划" />
        ) : (
          taskGraph.layers.map((layer, index) => (
            <div key={layer.id} className="mission-layer-wrap">
              {index > 0 ? <DependencyConnector active={hasHighlightedPath} /> : null}
              <ParallelLayerBlock layer={layer} onSelectTask={onSelectTask} />
            </div>
          ))
        )}
      </div>
      {taskGraph.layers.length > 0 ? (
        <MissionGraphLegend taskGraph={taskGraph} />
      ) : null}
    </section>
  );
}

function MissionGraphLegend({ taskGraph }: { taskGraph: MissionViewModel["taskGraph"] }) {
  const tasks = taskGraph.layers.flatMap((layer) => layer.tasks);
  const completed = tasks.filter((task) => task.status === "completed").length;
  const running = tasks.filter((task) => task.status === "running" || task.status === "preparing").length;
  const percent = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  return (
    <div className="mission-graph-footer">
      <div className="mission-graph-footer__bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="mission-graph-footer__meta">
        <span>{completed}/{tasks.length} 完成 · {running} 并行进行中</span>
        <span className="mission-legend">
          <span><i className="mission-dot mission-dot--completed" />已完成</span>
          <span><i className="mission-dot mission-dot--running" />进行中</span>
          <span><i className="mission-dot mission-dot--queued" />队列等待</span>
          <span><i className="mission-dot mission-dot--blocked" />阻塞</span>
        </span>
      </div>
    </div>
  );
}
