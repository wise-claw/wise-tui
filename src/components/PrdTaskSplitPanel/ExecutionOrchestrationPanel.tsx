import { ApartmentOutlined, BranchesOutlined, DatabaseOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { SplitResult, TaskRole } from "../../types";
import { taskRoleChineseLabel, taskRoleTagModifierClass } from "../../utils/repositoryType";
import {
  buildExecutionOrchestrationModel,
  type AgentDispatchOrchestrationItem,
  type RequirementOrchestrationItem,
  type TaskOrchestrationItem,
} from "./executionOrchestrationModel";

interface Props {
  result: SplitResult;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function ExecutionOrchestrationPanel({
  result,
  selectedTaskId,
  onSelectTask,
}: Props) {
  const model = useMemo(() => buildExecutionOrchestrationModel(result), [result]);
  return (
    <div className="app-prd-task-panel__orchestration">
      <section className="app-prd-task-panel__orchestration-column app-prd-task-panel__orchestration-column--requirements">
        <OrchestrationColumnTitle icon={<DatabaseOutlined />} title="PRD 需求" />
        <div className="app-prd-task-panel__orchestration-requirements">
          {model.requirements.map((requirement) => (
            <RequirementNode key={requirement.id} requirement={requirement} />
          ))}
        </div>
      </section>

      <section className="app-prd-task-panel__orchestration-column app-prd-task-panel__orchestration-column--tasks">
        <div className="app-prd-task-panel__orchestration-center-head">
          <OrchestrationColumnTitle icon={<ApartmentOutlined />} title="任务集群" />
          <span>
            {model.tasks.length} 个任务 · {model.parallelGroups.length} 组并行
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
        <OrchestrationColumnTitle icon={<BranchesOutlined />} title="派发 / 子代理" />
        <div className="app-prd-task-panel__orchestration-agents">
          {model.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onSelectTask={onSelectTask} />
          ))}
        </div>
      </section>
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

function RequirementNode({ requirement }: { requirement: RequirementOrchestrationItem }) {
  return (
    <article className={[
      "app-prd-task-panel__orchestration-req",
      requirement.taskIds.length > 0 ? "has-tasks" : "",
    ].filter(Boolean).join(" ")}
    >
      <span>{requirement.label}</span>
      <strong>{requirement.title}</strong>
      <p>{requirement.content}</p>
      <small>{requirement.priority}</small>
    </article>
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
