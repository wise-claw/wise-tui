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

export interface TaskConflictWarning {
  id: string;
  severity: "warning" | "critical";
  message: string;
  relatedTaskIds: string[];
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
  sourceRefs: string[];
  touchedFiles: string[];
  requirementLabel: string;
  requirementTitle: string;
  dependencyReasons: string[];
  conflictWarnings: TaskConflictWarning[];
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
  conflictWarnings: TaskConflictWarning[];
  completedTaskCount: number;
  runningTaskCount: number;
}

export function buildExecutionOrchestrationModel(result: SplitResult): ExecutionOrchestrationModel {
  const requirementEntries = listPrdRequirementIndexEntries(result.source);
  const requirementById = new Map(requirementEntries.map((requirement, index) => {
    const id = requirement.id.trim() || `REQ-${index + 1}`;
    return [id, {
      id,
      label: requirement.label,
      title: firstLine(requirement.content) || id,
    }];
  }));
  const conflictWarnings = detectConflictWarnings(result.splitTasks, result.parallelGroups);
  const conflictsByTaskId = groupConflictsByTaskId(conflictWarnings);
  const tasks = result.splitTasks.map((task) => toTaskOrchestrationItem(
    task,
    result.splitTasks,
    requirementById,
    conflictsByTaskId.get(task.id) ?? [],
  ));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const parallelGroups = normalizeParallelGroups(result.parallelGroups, result.splitTasks)
    .map((taskIds, index) => ({
      id: `parallel-group-${index + 1}`,
      title: `并行组 ${index + 1}`,
      taskIds,
      tasks: taskIds.map((taskId) => taskById.get(taskId)).filter((task): task is TaskOrchestrationItem => Boolean(task)),
    }))
    .filter((group) => group.tasks.length > 0);
  const requirements = requirementEntries.map((requirement, index) => {
    const id = requirement.id.trim() || `REQ-${index + 1}`;
    const linkedTaskIds = tasks
      .filter((task) => task.sourceRequirementIds.includes(id))
      .map((task) => task.id);
    return {
      id,
      label: requirement.label,
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
    conflictWarnings,
    completedTaskCount: tasks.filter((task) => task.statusLabel === "已完成").length,
    runningTaskCount: tasks.filter((task) => task.statusLabel === "进行中").length,
  };
}

function toTaskOrchestrationItem(
  task: TaskItem,
  allTasks: TaskItem[],
  requirementById: Map<string, { id: string; label: string; title: string }>,
  conflictWarnings: TaskConflictWarning[],
): TaskOrchestrationItem {
  const knownTaskIds = new Set(allTasks.map((item) => item.id));
  const dependencies = task.dependencies.filter((id) => id.trim().length > 0);
  const blockedBy = dependencies.filter((id) => knownTaskIds.has(id));
  const sourceRef = task.sourceRefs.find((ref) => ref.trim().length > 0) ?? null;
  const sourceRefs = [...new Set(task.sourceRefs.map((ref) => ref.trim()).filter(Boolean))];
  const touchedFiles = [...new Set(sourceRefs.map(filePathFromSourceRef).filter((file): file is string => Boolean(file)))];
  const primaryRequirementId = task.sourceRequirementIds[0] ?? "";
  const primaryRequirement = requirementById.get(primaryRequirementId);
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
    sourceRefs,
    touchedFiles,
    requirementLabel: primaryRequirement?.title ?? primaryRequirementId,
    requirementTitle: primaryRequirement?.title ?? "未映射需求",
    dependencyReasons: dependencies
      .map((id) => task.dependencyRationale?.[id]?.trim())
      .filter((reason): reason is string => Boolean(reason)),
    conflictWarnings,
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
  const text = `${task.title} ${task.description} ${task.sourceRefs.join(" ")}`.toLowerCase();
  if (text.includes("migration") || text.includes("schema") || text.includes("db/") || text.includes("database")) {
    return "DBA-Agent";
  }
  if (text.includes("config") || text.includes("yaml") || text.includes("yml") || text.includes("env")) {
    return "Config-Agent";
  }
  if (text.includes("api") || text.includes("service") || text.includes("controller")) {
    return "API-Agent";
  }
  if (task.role === "frontend") return "Frontend-Coder";
  if (task.role === "backend") return "Backend-Coder";
  return "Docs-Agent";
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

function detectConflictWarnings(tasks: TaskItem[], groups: string[][]): TaskConflictWarning[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const waves = groups.length > 0 ? groups : buildParallelGroups(tasks);
  const warnings: TaskConflictWarning[] = [];
  for (const [waveIndex, wave] of waves.entries()) {
    const fileToTasks = new Map<string, string[]>();
    for (const taskId of wave) {
      const task = taskById.get(taskId);
      if (!task) continue;
      for (const filePath of sourceFilesForTask(task)) {
        fileToTasks.set(filePath, [...(fileToTasks.get(filePath) ?? []), task.id]);
      }
    }
    for (const [filePath, taskIds] of fileToTasks.entries()) {
      if (taskIds.length <= 1) continue;
      warnings.push({
        id: `wave-${waveIndex + 1}:${filePath}`,
        severity: "critical",
        message: `同波次 ${taskIds.join(" / ")} 都会修改 ${filePath}，强行并行可能产生文件锁或合并冲突。`,
        relatedTaskIds: taskIds,
      });
    }
  }
  return warnings;
}

function groupConflictsByTaskId(warnings: TaskConflictWarning[]): Map<string, TaskConflictWarning[]> {
  const map = new Map<string, TaskConflictWarning[]>();
  for (const warning of warnings) {
    for (const taskId of warning.relatedTaskIds) {
      map.set(taskId, [...(map.get(taskId) ?? []), warning]);
    }
  }
  return map;
}

function sourceFilesForTask(task: TaskItem): string[] {
  return [...new Set(task.sourceRefs.map(filePathFromSourceRef).filter((file): file is string => Boolean(file)))];
}

function filePathFromSourceRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const [filePath] = trimmed.split(":");
  return filePath?.trim() || null;
}
