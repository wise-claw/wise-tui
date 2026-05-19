import type { SplitResult, TaskItem, TaskRole } from "../../types";
import { buildParallelGroups } from "../../services/taskDependency";
import { listPrdRequirementIndexEntries } from "../../services/prdRequirementIndex";

export interface RequirementOrchestrationItem {
  id: string;
  label: string;
  title: string;
  content: string;
  priority: string;
  taskIds: string[];
}

export interface TaskOrchestrationItem {
  id: string;
  title: string;
  role: TaskRole;
  sourceRequirementIds: string[];
  dependencies: string[];
  blockedBy: string[];
  repositoryLabel: string;
  sourceRef: string | null;
  lane: "ready" | "waiting" | "blocked";
  agentName: string;
  statusLabel: string;
}

export interface ParallelGroupOrchestrationItem {
  id: string;
  title: string;
  taskIds: string[];
  tasks: TaskOrchestrationItem[];
}

export interface AgentDispatchOrchestrationItem {
  id: string;
  title: string;
  role: TaskRole;
  status: "running" | "queued";
  tasks: TaskOrchestrationItem[];
}

export interface ExecutionOrchestrationModel {
  requirements: RequirementOrchestrationItem[];
  tasks: TaskOrchestrationItem[];
  parallelGroups: ParallelGroupOrchestrationItem[];
  agents: AgentDispatchOrchestrationItem[];
  completedTaskCount: number;
  runningTaskCount: number;
}

export function buildExecutionOrchestrationModel(result: SplitResult): ExecutionOrchestrationModel {
  const tasks = result.splitTasks.map((task) => toTaskOrchestrationItem(task, result.splitTasks));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const parallelGroups = normalizeParallelGroups(result.parallelGroups, result.splitTasks)
    .map((taskIds, index) => ({
      id: `parallel-group-${index + 1}`,
      title: `并行组 ${index + 1}`,
      taskIds,
      tasks: taskIds.map((taskId) => taskById.get(taskId)).filter((task): task is TaskOrchestrationItem => Boolean(task)),
    }))
    .filter((group) => group.tasks.length > 0);
  const requirements = listPrdRequirementIndexEntries(result.source).map((requirement, index) => {
    const id = requirement.id.trim() || `REQ-${index + 1}`;
    const linkedTaskIds = tasks
      .filter((task) => task.sourceRequirementIds.includes(id))
      .map((task) => task.id);
    return {
      id,
      label: id,
      title: firstLine(requirement.content) || id,
      content: requirement.content.trim(),
      priority: priorityLabel(index),
      taskIds: linkedTaskIds,
    };
  });
  const agents = buildAgentDispatchItems(tasks);
  return {
    requirements,
    tasks,
    parallelGroups,
    agents,
    completedTaskCount: tasks.filter((task) => task.statusLabel === "已完成").length,
    runningTaskCount: tasks.filter((task) => task.statusLabel === "进行中").length,
  };
}

function toTaskOrchestrationItem(task: TaskItem, allTasks: TaskItem[]): TaskOrchestrationItem {
  const knownTaskIds = new Set(allTasks.map((item) => item.id));
  const dependencies = task.dependencies.filter((id) => id.trim().length > 0);
  const blockedBy = dependencies.filter((id) => knownTaskIds.has(id));
  const sourceRef = task.sourceRefs.find((ref) => ref.trim().length > 0) ?? null;
  const statusLabel = flowStatusLabel(task.flowStatus);
  return {
    id: task.id,
    title: task.title,
    role: task.role,
    sourceRequirementIds: [...task.sourceRequirementIds],
    dependencies,
    blockedBy,
    repositoryLabel: repositoryLabelForTask(task),
    sourceRef,
    lane: task.executionStatus === "not_executable"
      ? "blocked"
      : blockedBy.length > 0 ? "waiting" : "ready",
    agentName: agentNameForTask(task),
    statusLabel,
  };
}

function normalizeParallelGroups(groups: string[][], splitTasks: TaskItem[]): string[][] {
  const taskIds = new Set(splitTasks.map((task) => task.id));
  const validGroups = groups
    .map((group) => group.filter((taskId) => taskIds.has(taskId)))
    .filter((group) => group.length > 0);
  return validGroups.length > 0 ? validGroups : buildParallelGroups(splitTasks);
}

function buildAgentDispatchItems(tasks: TaskOrchestrationItem[]): AgentDispatchOrchestrationItem[] {
  const map = new Map<string, TaskOrchestrationItem[]>();
  for (const task of tasks) {
    const key = `${task.role}:${task.repositoryLabel}`;
    map.set(key, [...(map.get(key) ?? []), task]);
  }
  return [...map.entries()].map(([key, groupTasks]) => {
    const [role, repositoryLabel] = key.split(":");
    const typedRole = role === "frontend" || role === "backend" || role === "document" ? role : "document";
    return {
      id: key,
      title: repositoryLabel,
      role: typedRole,
      status: groupTasks.some((task) => task.statusLabel === "进行中") ? "running" : "queued",
      tasks: groupTasks,
    };
  });
}

function repositoryLabelForTask(task: TaskItem): string {
  if (task.splitListWorkflowId?.trim()) return task.splitListWorkflowId.trim();
  return task.role === "frontend" ? "frontend-app" : task.role === "backend" ? "backend-api" : "docs";
}

function agentNameForTask(task: TaskItem): string {
  if (task.splitListEmployeeName?.trim()) return task.splitListEmployeeName.trim();
  if (task.role === "frontend") return "trellis-implement";
  if (task.role === "backend") return "trellis-implement";
  return "trellis-research";
}

function flowStatusLabel(status: TaskItem["flowStatus"]): string {
  switch (status) {
    case "done":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "pending_review":
      return "待复核";
    case "cancelled":
      return "已中断";
    case "todo":
    default:
      return "等待";
  }
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? "";
}

function priorityLabel(index: number): string {
  if (index === 0) return "P0 必做";
  if (index === 1) return "P1 重要";
  return "P2 可延期";
}
