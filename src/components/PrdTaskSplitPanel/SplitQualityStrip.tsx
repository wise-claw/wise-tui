interface Stats {
  mappedTaskCount: number;
  totalTasks: number;
  mappingRate: number;
  traceableTaskCount: number;
  traceRate: number;
  untraceableTaskIds: string[];
}

interface Props {
  stats: Stats | null;
}

export function SplitQualityStrip({ stats }: Props) {
  if (!stats) return null;
  return (
    <div className="app-prd-task-panel__quality-strip">
      <span className="app-prd-task-panel__quality-chip">
        映射覆盖 {stats.mappedTaskCount}/{stats.totalTasks}（{stats.mappingRate}%）
      </span>
      <span
        className={[
          "app-prd-task-panel__quality-chip",
          stats.untraceableTaskIds.length > 0
            ? "app-prd-task-panel__quality-chip--warning"
            : "app-prd-task-panel__quality-chip--good",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        锚点可追溯 {stats.traceableTaskCount}/{stats.totalTasks}（{stats.traceRate}%）
      </span>
      {stats.untraceableTaskIds.length > 0 ? (
        <span className="app-prd-task-panel__quality-chip app-prd-task-panel__quality-chip--warning">
          不可追溯：{stats.untraceableTaskIds.join(", ")}
        </span>
      ) : null}
    </div>
  );
}
