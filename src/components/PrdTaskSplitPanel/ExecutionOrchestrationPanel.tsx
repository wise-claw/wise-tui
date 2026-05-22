import { AlertOutlined, ApartmentOutlined, BranchesOutlined, DeploymentUnitOutlined, HolderOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { SplitResult, TaskRole } from "../../types";
import { taskRoleChineseLabel, taskRoleTagModifierClass } from "../../utils/repositoryType";
import {
  buildExecutionOrchestrationModel,
  type AgentDispatchOrchestrationItem,
  type ParallelGroupOrchestrationItem,
  type TaskOrchestrationItem,
} from "./executionOrchestrationModel";

interface Props {
  result: SplitResult;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onMoveTask: (taskId: string, direction: "earlier" | "later") => void;
  onMoveTaskToWave: (taskId: string, waveIndex: number) => void;
}

export function ExecutionOrchestrationPanel({
  result,
  selectedTaskId,
  onSelectTask,
  onMoveTask,
  onMoveTaskToWave,
}: Props) {
  const model = useMemo(() => buildExecutionOrchestrationModel(result), [result]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const maxParallel = Math.max(0, ...model.parallelGroups.map((group) => group.tasks.length));

  function handleDrop(event: DragEvent<HTMLElement>, waveIndex: number) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
    setDraggingTaskId(null);
    if (!taskId) return;
    onMoveTaskToWave(taskId, waveIndex);
  }

  return (
    <div className="app-prd-task-panel__orchestration">
      <aside className="app-prd-task-panel__orchestration-requirements-panel">
        <div className="app-prd-task-panel__orchestration-panel-head">
          <strong>需求上下文</strong>
          <span>需求 → 任务</span>
        </div>
        <div className="app-prd-task-panel__orchestration-requirement-list">
          {model.requirements.map((requirement) => (
            <button
              key={requirement.id}
              type="button"
              className={[
                "app-prd-task-panel__orchestration-requirement-card",
                requirement.taskIds.length > 0 ? "has-tasks" : "",
                requirement.taskIds.includes(selectedTaskId ?? "") ? "is-active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                const firstTaskId = requirement.taskIds[0];
                if (firstTaskId) onSelectTask(firstTaskId);
              }}
            >
              <strong>{requirement.title}</strong>
              <span>{requirement.label}</span>
              <small>{requirement.taskIds.length} Tasks</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="app-prd-task-panel__orchestration-board">
        <div className="app-prd-task-panel__orchestration-board-head">
          <div>
            <strong>编排确认 · 执行波次</strong>
            <span>拖拽任务调整执行批次；卡片展示需求来源、依赖和目标仓库。</span>
          </div>
          <div className="app-prd-task-panel__orchestration-board-actions">
            <SummaryPill icon={<DeploymentUnitOutlined />} text={`${model.tasks.length} 任务`} />
            <SummaryPill icon={<ApartmentOutlined />} text={`${model.parallelGroups.length} 波次`} />
            <SummaryPill icon={<BranchesOutlined />} text={`${maxParallel}x 并行`} />
          </div>
        </div>

        <div className="app-prd-task-panel__orchestration-wave-grid">
          {model.parallelGroups.map((group, index) => (
            <WaveColumn
              key={group.id}
              group={group}
              index={index}
              selectedTaskId={selectedTaskId}
              draggingTaskId={draggingTaskId}
              onSelectTask={onSelectTask}
              onDragStart={(taskId) => setDraggingTaskId(taskId)}
              onDragEnd={() => setDraggingTaskId(null)}
              onDrop={handleDrop}
            />
          ))}
          <SerialDropColumn
            index={model.parallelGroups.length}
            dragging={Boolean(draggingTaskId)}
            onDrop={handleDrop}
          />
        </div>
      </section>

      <aside className="app-prd-task-panel__orchestration-dispatch">
        <div className="app-prd-task-panel__orchestration-dispatch-head">
          <strong>执行预览</strong>
          <span>{model.conflictWarnings.length > 0 ? `${model.conflictWarnings.length} 个冲突` : "等待开始"}</span>
        </div>
        {model.conflictWarnings.length > 0 ? (
          <div className="app-prd-task-panel__orchestration-conflict-list">
            {model.conflictWarnings.map((warning) => (
              <div key={warning.id} className={`app-prd-task-panel__orchestration-conflict is-${warning.severity}`}>
                <AlertOutlined />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="app-prd-task-panel__orchestration-dispatch-waves">
          {model.parallelGroups.map((group, index) => (
            <DispatchWave
              key={group.id}
              index={index}
              group={group}
              onSelectTask={onSelectTask}
              onMoveTask={onMoveTask}
            />
          ))}
        </div>
        <div className="app-prd-task-panel__orchestration-agent-summary">
          {model.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onSelectTask={onSelectTask} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function SummaryPill({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string;
}) {
  return (
    <span className="app-prd-task-panel__orchestration-summary-pill">
      {icon}
      {text}
    </span>
  );
}

function WaveColumn({
  group,
  index,
  selectedTaskId,
  draggingTaskId,
  onSelectTask,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  group: ParallelGroupOrchestrationItem;
  index: number;
  selectedTaskId: string | null;
  draggingTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLElement>, waveIndex: number) => void;
}) {
  return (
    <article
      className="app-prd-task-panel__orchestration-wave-column"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, index)}
    >
      <div className="app-prd-task-panel__orchestration-wave-column-head">
        <div>
          <strong>{waveTitle(index)}</strong>
          <span>{group.tasks.length > 1 ? `${group.tasks.length} 个任务并行` : "串行节点"}</span>
        </div>
        <small>{index === 0 ? "无前置依赖" : "依赖上一波次"}</small>
      </div>
      <div className="app-prd-task-panel__orchestration-task-stack">
        {group.tasks.map((task) => (
          <TaskNode
            key={task.id}
            task={task}
            selected={selectedTaskId === task.id}
            dragging={draggingTaskId === task.id}
            onSelectTask={onSelectTask}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </article>
  );
}

function SerialDropColumn({
  index,
  dragging,
  onDrop,
}: {
  index: number;
  dragging: boolean;
  onDrop: (event: DragEvent<HTMLElement>, waveIndex: number) => void;
}) {
  return (
    <article
      className={[
        "app-prd-task-panel__orchestration-wave-column",
        "app-prd-task-panel__orchestration-wave-column--serial-drop",
        dragging ? "is-dragging" : "",
      ].filter(Boolean).join(" ")}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, index)}
    >
      <div>
        <strong>串行链路</strong>
        <span>拖到这里作为后置步骤执行</span>
      </div>
    </article>
  );
}

function TaskNode({
  task,
  selected,
  dragging,
  onSelectTask,
  onDragStart,
  onDragEnd,
}: {
  task: TaskOrchestrationItem;
  selected: boolean;
  dragging: boolean;
  onSelectTask: (taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      className={[
        "app-prd-task-panel__orchestration-task",
        `app-prd-task-panel__orchestration-task--${task.lane}`,
        selected ? "is-active" : "",
        dragging ? "is-dragging" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelectTask(task.id)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
    >
      <HolderOutlined className="app-prd-task-panel__orchestration-task-grip" />
      <span className="app-prd-task-panel__orchestration-task-dot" aria-hidden="true" />
      <span className="app-prd-task-panel__orchestration-task-main">
        <strong>{task.id} · {task.title}</strong>
        <small>{task.blockedBy.length > 0 ? `依赖 ${task.blockedBy.join(" / ")}` : "无前置依赖"}</small>
      </span>
      <span className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}>
        {taskRoleChineseLabel(task.role)}
      </span>
      {task.conflictWarnings.length > 0 ? (
        <span className="app-prd-task-panel__orchestration-task-conflict">冲突</span>
      ) : null}
      <span className="app-prd-task-panel__orchestration-task-trace">
        From: {task.requirementLabel || task.sourceRequirementIds.join(" / ") || "未映射"}
      </span>
      {task.touchedFiles[0] || task.sourceRef ? (
        <span className="app-prd-task-panel__orchestration-task-file">
          {task.touchedFiles[0] ?? task.sourceRef}
        </span>
      ) : null}
      <span className="app-prd-task-panel__orchestration-task-agent">
        {task.agentName}
      </span>
    </button>
  );
}

function DispatchWave({
  index,
  group,
  onSelectTask,
  onMoveTask,
}: {
  index: number;
  group: ParallelGroupOrchestrationItem;
  onSelectTask: (taskId: string) => void;
  onMoveTask: (taskId: string, direction: "earlier" | "later") => void;
}) {
  return (
    <article className="app-prd-task-panel__orchestration-wave">
      <div className="app-prd-task-panel__orchestration-wave-head">
        <strong>{waveTitle(index)}</strong>
        <span>{group.tasks.length > 1 ? `${group.tasks.length} 个任务并行` : "串行收口节点"}</span>
      </div>
      <div className="app-prd-task-panel__orchestration-wave-runs">
        {group.tasks.map((task) => (
          <div key={task.id} className="app-prd-task-panel__orchestration-wave-run">
            <button type="button" onClick={() => onSelectTask(task.id)}>
              <span>{task.agentName}</span>
              <strong>{task.id}</strong>
              <small>{task.title}</small>
            </button>
            <div className="app-prd-task-panel__orchestration-wave-actions">
              <button type="button" aria-label={`将 ${task.id} 移到上一波次`} onClick={() => onMoveTask(task.id, "earlier")}>↑</button>
              <button type="button" aria-label={`将 ${task.id} 移到下一波次`} onClick={() => onMoveTask(task.id, "later")}>↓</button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function AgentCard({
  agent,
  onSelectTask,
}: {
  agent: AgentDispatchOrchestrationItem;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <article className="app-prd-task-panel__orchestration-agent">
      <div className="app-prd-task-panel__orchestration-agent-head">
        <span className={`app-prd-task-panel__orchestration-agent-icon app-prd-task-panel__orchestration-agent-icon--${agent.role}`}>
          {roleInitial(agent.role)}
        </span>
        <div>
          <strong>{agent.title}</strong>
          <small>{agent.status === "running" ? "运行中" : "等待开始"}</small>
        </div>
      </div>
      <div className="app-prd-task-panel__orchestration-agent-runs">
        {agent.tasks.map((task) => (
          <button key={task.id} type="button" onClick={() => onSelectTask(task.id)}>
            <span>{task.agentName}</span>
            <strong>{task.id}</strong>
            <small>{task.statusLabel}</small>
          </button>
        ))}
      </div>
    </article>
  );
}

function roleInitial(role: TaskRole): string {
  if (role === "frontend") return "前";
  if (role === "backend") return "后";
  return "文";
}

function waveTitle(index: number): string {
  return index === 0 ? "并行框" : `串行链路 ${index}`;
}
