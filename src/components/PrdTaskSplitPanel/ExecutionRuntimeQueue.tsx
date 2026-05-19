import { CheckCircleOutlined, ClockCircleOutlined, PauseCircleOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useMemo } from "react";
import type { SplitResult } from "../../types";
import { taskRoleChineseLabel, taskRoleTagModifierClass } from "../../utils/repositoryType";
import { buildExecutionOrchestrationModel, type TaskOrchestrationItem } from "./executionOrchestrationModel";

interface Props {
  result: SplitResult;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onBackToPlan: () => void;
}

export function ExecutionRuntimeQueue({
  result,
  selectedTaskId,
  onSelectTask,
  onBackToPlan,
}: Props) {
  const model = useMemo(() => buildExecutionOrchestrationModel(result), [result]);
  return (
    <div className="app-prd-task-panel__execution-runtime">
      <header className="app-prd-task-panel__execution-runtime-head">
        <div>
          <span>Mission Runtime</span>
          <strong>执行中任务队列</strong>
          <p>任务已从候选清单进入 wave fan-out 队列；仓库成员面板应同步展示这些 subagent 的运行状态。</p>
        </div>
        <div className="app-prd-task-panel__execution-runtime-actions">
          <Button size="small" onClick={onBackToPlan}>返回编排</Button>
          <Button size="small" icon={<PauseCircleOutlined />} disabled>暂停后续波次</Button>
        </div>
      </header>

      <div className="app-prd-task-panel__execution-runtime-summary">
        <RuntimeSummaryItem label="运行中" value={model.parallelGroups[0]?.tasks.length ?? 0} />
        <RuntimeSummaryItem label="等待波次" value={Math.max(0, model.parallelGroups.length - 1)} />
        <RuntimeSummaryItem label="子代理" value={model.tasks.length} />
      </div>

      <div className="app-prd-task-panel__execution-runtime-waves">
        {model.parallelGroups.map((group, index) => {
          const waveStatus = index === 0 ? "running" : "waiting";
          return (
            <section key={group.id} className={`app-prd-task-panel__execution-runtime-wave is-${waveStatus}`}>
              <div className="app-prd-task-panel__execution-runtime-wave-head">
                <div>
                  <strong>波次 {index + 1}</strong>
                  <span>{waveStatus === "running" ? "正在并行执行" : "等待前置波次完成"}</span>
                </div>
                {waveStatus === "running" ? <PlayCircleOutlined /> : <ClockCircleOutlined />}
              </div>
              <div className="app-prd-task-panel__execution-runtime-task-list">
                {group.tasks.map((task, taskIndex) => (
                  <RuntimeTaskRow
                    key={task.id}
                    task={task}
                    status={waveStatus}
                    agentName={`subagent-${String.fromCharCode(65 + index * 4 + taskIndex)}`}
                    selected={task.id === selectedTaskId}
                    onSelectTask={onSelectTask}
                  />
                ))}
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
  agentName,
  selected,
  onSelectTask,
}: {
  task: TaskOrchestrationItem;
  status: "running" | "waiting";
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
          {status === "running" ? <PlayCircleOutlined /> : <ClockCircleOutlined />}
        </span>
        <span className="app-prd-task-panel__execution-runtime-task-main">
          <strong>{task.id} · {task.title}</strong>
          <small>{agentName} · {task.repositoryLabel}</small>
        </span>
        <span className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}>
          {taskRoleChineseLabel(task.role)}
        </span>
      </button>
      <div className="app-prd-task-panel__execution-runtime-task-actions">
        <Button size="small" icon={<CheckCircleOutlined />} disabled>产物</Button>
        <Button size="small" icon={<StopOutlined />} disabled>{status === "running" ? "运行中" : "删除"}</Button>
      </div>
    </article>
  );
}
