import { ApartmentOutlined, BranchesOutlined, CheckCircleOutlined, DeploymentUnitOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { SplitResult, TaskRole } from "../../types";
import { taskRoleChineseLabel, taskRoleTagModifierClass } from "../../utils/repositoryType";
import {
  buildExecutionOrchestrationModel,
  type AgentDispatchOrchestrationItem,
  type TaskOrchestrationItem,
} from "./executionOrchestrationModel";

interface Props {
  result: SplitResult;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onMoveTask: (taskId: string, direction: "earlier" | "later") => void;
}

export function ExecutionOrchestrationPanel({
  result,
  selectedTaskId,
  onSelectTask,
  onMoveTask,
}: Props) {
  const model = useMemo(() => buildExecutionOrchestrationModel(result), [result]);
  return (
    <div className="app-prd-task-panel__orchestration">
      <section className="app-prd-task-panel__orchestration-column app-prd-task-panel__orchestration-column--requirements">
        <OrchestrationColumnTitle icon={<DeploymentUnitOutlined />} title="编排层" />
        <div className="app-prd-task-panel__orchestration-handoff">
          <div className="app-prd-task-panel__orchestration-handoff-card">
            <strong>任务清单 → 执行图 DAG</strong>
            <span>{model.tasks.length} 个任务 · {model.parallelGroups.length} 个执行波次</span>
          </div>
          <div className="app-prd-task-panel__orchestration-handoff-steps">
            <HandoffStep active label="① PRD 拆分：候选任务清单" />
            <HandoffStep active={model.tasks.length > 0} label="② 依赖分析：自动生成 DAG" />
            <HandoffStep active={model.tasks.length > 0} label="③ 编排确认：调整波次/依赖" />
            <HandoffStep label="④ Fan-out 执行：按波次派发" />
          </div>
          <div className="app-prd-task-panel__orchestration-handoff-card app-prd-task-panel__orchestration-handoff-card--trellis">
            <strong><FolderOpenOutlined /> .trellis/tasks/</strong>
            <span>确认落盘后写入 task 目录与 agent 上下文</span>
          </div>
        </div>
      </section>

      <section className="app-prd-task-panel__orchestration-column app-prd-task-panel__orchestration-column--tasks">
        <div className="app-prd-task-panel__orchestration-center-head">
          <OrchestrationColumnTitle icon={<ApartmentOutlined />} title="② 依赖分析 · 执行波次" />
          <span>
            {model.tasks.length} 个任务 · {model.parallelGroups.length} 波次
          </span>
        </div>
        <div className="app-prd-task-panel__orchestration-groups">
          {model.parallelGroups.map((group) => (
            <div key={group.id} className="app-prd-task-panel__orchestration-group">
              <div className="app-prd-task-panel__orchestration-group-head">
                <span>{group.title}</span>
                <small>{group.tasks.length > 1 ? `${group.tasks.length} 个任务可并行` : "串行节点"}</small>
              </div>
              <div className="app-prd-task-panel__orchestration-task-stack">
                {group.tasks.map((task) => (
                  <TaskNode
                    key={task.id}
                    task={task}
                    selected={selectedTaskId === task.id}
                    onSelectTask={onSelectTask}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="app-prd-task-panel__orchestration-progress">
          <div>
            <span style={{ width: `${progressPercent(model.completedTaskCount, model.tasks.length)}%` }} />
          </div>
          <p>{model.completedTaskCount}/{model.tasks.length} 完成 · {model.runningTaskCount} 进行中</p>
        </div>
      </section>

      <section className="app-prd-task-panel__orchestration-column app-prd-task-panel__orchestration-column--agents">
        <OrchestrationColumnTitle icon={<BranchesOutlined />} title="④ Fan-out 执行计划" />
        <div className="app-prd-task-panel__orchestration-fanout">
          {model.parallelGroups.map((group, index) => (
            <FanoutWave
              key={group.id}
              index={index}
              group={group}
              canMoveEarlier={index > 0}
              canMoveLater={index < model.parallelGroups.length - 1 || group.tasks.length > 1}
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
      </section>
    </div>
  );
}

function HandoffStep({ active, label }: { active?: boolean; label: string }) {
  return (
    <div className={[
      "app-prd-task-panel__orchestration-handoff-step",
      active ? "is-active" : "",
    ].filter(Boolean).join(" ")}
    >
      <CheckCircleOutlined />
      <span>{label}</span>
    </div>
  );
}

function OrchestrationColumnTitle({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="app-prd-task-panel__orchestration-title">
      <span>{icon}</span>
      <strong>{title}</strong>
    </div>
  );
}

function TaskNode({
  task,
  selected,
  onSelectTask,
}: {
  task: TaskOrchestrationItem;
  selected: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <button
      type="button"
      className={[
        "app-prd-task-panel__orchestration-task",
        `app-prd-task-panel__orchestration-task--${task.lane}`,
        selected ? "is-active" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelectTask(task.id)}
    >
      <span className="app-prd-task-panel__orchestration-task-dot" aria-hidden="true" />
      <span className="app-prd-task-panel__orchestration-task-main">
        <strong>{task.id} · {task.title}</strong>
        <small>{task.sourceRef ?? "待锚点定位"}</small>
      </span>
      <span className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}>
        {taskRoleChineseLabel(task.role)}
      </span>
      <span className="app-prd-task-panel__orchestration-task-trace">
        ↖ {task.sourceRequirementIds.join(" / ") || "未映射"}
      </span>
      <span className="app-prd-task-panel__orchestration-task-state">
        {task.blockedBy.length > 0 ? `等待 ${task.blockedBy.join("/")}` : task.statusLabel}
      </span>
    </button>
  );
}

function FanoutWave({
  index,
  group,
  canMoveEarlier,
  canMoveLater,
  onSelectTask,
  onMoveTask,
}: {
  index: number;
  group: { id: string; title: string; tasks: TaskOrchestrationItem[] };
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onSelectTask: (taskId: string) => void;
  onMoveTask: (taskId: string, direction: "earlier" | "later") => void;
}) {
  return (
    <article className="app-prd-task-panel__orchestration-wave">
      <div className="app-prd-task-panel__orchestration-wave-head">
        <strong>波次 {index + 1}</strong>
        <span>{group.tasks.length > 1 ? `${group.tasks.length} 个并行子代理` : "串行收口节点"}</span>
      </div>
      <div className="app-prd-task-panel__orchestration-wave-runs">
        {group.tasks.map((task, taskIndex) => (
          <div key={task.id} className="app-prd-task-panel__orchestration-wave-run">
            <button type="button" onClick={() => onSelectTask(task.id)}>
              <span>{`agent-${String.fromCharCode(65 + index * 4 + taskIndex)}`}</span>
              <strong>{task.id}</strong>
              <small>{task.title}</small>
            </button>
            <div className="app-prd-task-panel__orchestration-wave-actions">
              <button
                type="button"
                disabled={!canMoveEarlier}
                onClick={() => onMoveTask(task.id, "earlier")}
              >
                前移
              </button>
              <button
                type="button"
                disabled={!canMoveLater}
                onClick={() => onMoveTask(task.id, "later")}
              >
                后移
              </button>
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
          <small>{agent.status === "running" ? "运行中" : "等待派发"}</small>
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

function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
