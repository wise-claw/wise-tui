import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, LoadingOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useMemo } from "react";
import type { SplitResult } from "../../types";
import type {
  ExecutionFanoutSnapshot,
  ExecutionFanoutTaskSnapshot,
  ExecutionFanoutTaskStatus,
  ExecutionFanoutWaveStatus,
} from "../../services/prdSplit/executionFanout";
import { taskRoleChineseLabel, taskRoleTagModifierClass } from "../../utils/repositoryType";
import { buildExecutionOrchestrationModel, type TaskOrchestrationItem } from "./executionOrchestrationModel";
import type { RequirementMissionMaterializeResult } from "./useRequirementMissionController";

interface Props {
  result: SplitResult;
  materializedResult: RequirementMissionMaterializeResult | null;
  fanoutSnapshot: ExecutionFanoutSnapshot | null;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function ExecutionRuntimeQueue({
  result,
  materializedResult,
  fanoutSnapshot,
  selectedTaskId,
  onSelectTask,
}: Props) {
  const model = useMemo(() => buildExecutionOrchestrationModel(result), [result]);
  const materializedBySourceId = useMemo(() => new Map(
    (materializedResult?.childTasks ?? []).map((task) => [task.sourceTaskId, task]),
  ), [materializedResult]);
  const fanoutTaskBySourceId = useMemo(() => {
    const map = new Map<string, ExecutionFanoutTaskSnapshot>();
    for (const wave of fanoutSnapshot?.waves ?? []) {
      for (const task of wave.tasks) map.set(task.sourceTaskId, task);
    }
    return map;
  }, [fanoutSnapshot]);
  const fanoutWaveByIndex = useMemo(() => new Map(
    (fanoutSnapshot?.waves ?? []).map((wave) => [wave.waveIndex, wave]),
  ), [fanoutSnapshot]);
  const runningCount = fanoutSnapshot?.waves.flatMap((wave) => wave.tasks).filter((task) => task.status === "running").length ?? 0;
  return (
    <div className="app-prd-task-panel__execution-runtime">

      <div className="app-prd-task-panel__execution-runtime-summary">
        <RuntimeSummaryItem label="已落盘" value={materializedResult?.childTaskNames.length ?? 0} />
        <RuntimeSummaryItem label="执行中" value={runningCount} />
        <RuntimeSummaryItem label="已完成" value={fanoutSnapshot?.doneCount ?? 0} />
      </div>

      <div className="app-prd-task-panel__execution-runtime-waves">
        {model.parallelGroups.map((group, index) => {
          const waveStatus = fanoutWaveByIndex.get(index)?.status ?? (index === 0 ? "running" : "waiting");
          return (
            <section key={group.id} className={`app-prd-task-panel__execution-runtime-wave is-${waveStatus}`}>
              <div className="app-prd-task-panel__execution-runtime-wave-head">
                <div>
                  <strong>波次 {index + 1}</strong>
                  <span>{waveStatusText(waveStatus)}</span>
                </div>
                {waveIcon(waveStatus)}
              </div>
              <div className="app-prd-task-panel__execution-runtime-task-list">
                {group.tasks.map((task, taskIndex) => {
                  const fanoutTask = fanoutTaskBySourceId.get(task.id);
                  return (
                    <RuntimeTaskRow
                      key={task.id}
                      task={task}
                      status={fanoutTask?.status ?? taskStatusFromWave(waveStatus)}
                      taskName={materializedBySourceId.get(task.id)?.taskName ?? fanoutTask?.taskName ?? null}
                      taskPath={fanoutTask?.activeTaskPath ?? materializedBySourceId.get(task.id)?.taskPath ?? null}
                      agentName={`subagent-${String.fromCharCode(65 + index * 4 + taskIndex)}`}
                      selected={task.id === selectedTaskId}
                      onSelectTask={onSelectTask}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeSummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RuntimeTaskRow({
  task,
  status,
  taskName,
  taskPath,
  agentName,
  selected,
  onSelectTask,
}: {
  task: TaskOrchestrationItem;
  status: ExecutionFanoutTaskStatus;
  taskName: string | null;
  taskPath: string | null;
  agentName: string;
  selected: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <article
      className={[
        "app-prd-task-panel__execution-runtime-task",
        `is-${status}`,
        selected ? "is-active" : "",
      ].filter(Boolean).join(" ")}
    >
      <button type="button" onClick={() => onSelectTask(task.id)}>
        <span className="app-prd-task-panel__execution-runtime-task-icon">
          {taskIcon(status)}
        </span>
        <span className="app-prd-task-panel__execution-runtime-task-main">
          <strong>{task.id} · {task.title}</strong>
          <small>{taskName ?? agentName} · {taskPath ?? task.repositoryLabel}</small>
        </span>
        <span className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}>
          {taskRoleChineseLabel(task.role)}
        </span>
      </button>
      <div className="app-prd-task-panel__execution-runtime-task-actions">
        <Button size="small" icon={<CheckCircleOutlined />} disabled>产物</Button>
        <Button size="small" icon={<StopOutlined />} disabled>{taskStatusText(status)}</Button>
      </div>
    </article>
  );
}


function waveStatusText(status: ExecutionFanoutWaveStatus) {
  if (status === "running") return "本波次子代理执行中";
  if (status === "succeeded") return "本波次已完成";
  if (status === "failed") return "本波次执行失败";
  return "等待前置波次完成";
}

function waveIcon(status: ExecutionFanoutWaveStatus) {
  if (status === "running") return <LoadingOutlined />;
  if (status === "succeeded") return <CheckCircleOutlined />;
  if (status === "failed") return <CloseCircleOutlined />;
  return <ClockCircleOutlined />;
}

function taskStatusFromWave(status: ExecutionFanoutWaveStatus): ExecutionFanoutTaskStatus {
  if (status === "running") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  return "waiting";
}

function taskIcon(status: ExecutionFanoutTaskStatus) {
  if (status === "running") return <PlayCircleOutlined />;
  if (status === "succeeded") return <CheckCircleOutlined />;
  if (status === "failed") return <CloseCircleOutlined />;
  return <ClockCircleOutlined />;
}

function taskStatusText(status: ExecutionFanoutTaskStatus) {
  if (status === "running") return "执行中";
  if (status === "succeeded") return "完成";
  if (status === "failed") return "失败";
  return "等待";
}
