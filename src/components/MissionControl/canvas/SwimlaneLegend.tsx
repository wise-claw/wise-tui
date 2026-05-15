import type { SwimlaneVM } from "../presenter/types";

export function SwimlaneLegend({ swimlane }: { swimlane: SwimlaneVM[] }) {
  const tasks = swimlane.flatMap((lane) => lane.tasks);
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
