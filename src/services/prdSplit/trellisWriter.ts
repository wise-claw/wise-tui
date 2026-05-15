/**
 * Trellis 任务落盘服务 — 把 PRD 拆分 normalizer 输出写到 `.trellis/tasks/<父>/<子>/`。
 *
 * 设计目标：
 * - 通过 Tauri 命令背后的 `task.py` 走唯一落盘入口；TS 这层只做装配与投影。
 * - 单 cluster / 多 cluster 共用同一接口；父任务一次创建，多 cluster 时由调用方循环。
 * - 严格不修改 `src/components/PrdTaskSplitPanel/**`（并行重构禁区）。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  PrdDocument,
  PrdStoredClaudeSplitMapping,
  SplitResult,
  TaskAnchorDescriptor,
  TaskItem,
} from "../../types";

export interface ClusterRef {
  id: string;
  title: string;
  primaryRepositoryId: number | null;
  repositoryIds: number[];
}

export interface CreateParentTaskInput {
  projectRootPath: string;
  cluster: ClusterRef;
  prdMarkdown: string;
  requirementsIndexJson: string;
  description?: string;
}

export interface CreateParentTaskOutput {
  parentTaskName: string;
  parentTaskPath: string;
}

export interface WriteClusterTasksInput {
  projectRootPath: string;
  parentTaskName: string;
  cluster: ClusterRef;
  normalized: SplitResult;
  prdSource: PrdDocument;
}

export interface WriteClusterTasksOutput {
  parentTaskName: string;
  childTaskNames: string[];
  childTasks: MaterializedChildTaskRef[];
  warnings: string[];
}

interface RustChildTaskPayload {
  sourceTaskId: string;
  title: string;
  slug: string;
  prdMarkdown: string;
  repositoryId: number | null;
  clusterId: string;
  role: string;
  dependencies: string[];
  sourceRequirementIds: string[];
  taskAnchors: TaskAnchorDescriptor | null;
  classification: "lightweight" | "complex";
  designMarkdown: string | null;
  implementMarkdown: string | null;
}

interface RustMaterializePayload {
  projectRootPath: string;
  parentTaskName: string;
  cluster: ClusterRef;
  childTasks: RustChildTaskPayload[];
  claudeSplitMapping: PrdStoredClaudeSplitMapping | null;
}

export interface MaterializedChildTaskRef {
  sourceTaskId: string;
  taskName: string;
  taskPath: string;
}

export async function createParentTask(input: CreateParentTaskInput): Promise<CreateParentTaskOutput> {
  return invoke<CreateParentTaskOutput>("prd_split_create_parent_task", {
    input: {
      projectRootPath: input.projectRootPath,
      clusterId: input.cluster.id,
      title: input.cluster.title,
      description: input.description ?? "",
      prdMarkdown: input.prdMarkdown,
      requirementsIndexJson: input.requirementsIndexJson,
      primaryRepositoryId: input.cluster.primaryRepositoryId,
      repositoryIds: input.cluster.repositoryIds,
    },
  });
}

export async function writeClusterTasks(input: WriteClusterTasksInput): Promise<WriteClusterTasksOutput> {
  const payload = buildMaterializePayload(input);
  return invoke<WriteClusterTasksOutput>("prd_split_materialize_tasks", { input: payload });
}

export interface MarkChildrenPlanningInput {
  projectRootPath: string;
  parentTaskName: string;
  excludeChildNames?: string[];
}

export interface MarkChildrenPlanningOutput {
  updatedChildNames: string[];
  skipped: string[];
}

/**
 * 把父任务的所有现有子任务 `task.json.status` 改回 `"planning"`（语义为 pending_review）。
 * 用于 dirty cluster 重派前把基线之外的旧子任务回退到「待复核」。
 */
export async function markChildrenPlanning(
  input: MarkChildrenPlanningInput,
): Promise<MarkChildrenPlanningOutput> {
  return invoke<MarkChildrenPlanningOutput>("prd_split_mark_children_status", {
    input: {
      projectRootPath: input.projectRootPath,
      parentTaskName: input.parentTaskName,
      newStatus: "planning",
      excludeChildNames: input.excludeChildNames ?? [],
    },
  });
}

/** 纯函数：把 `WriteClusterTasksInput` 投影成 Rust 端的写盘 payload。 */
export function buildMaterializePayload(input: WriteClusterTasksInput): RustMaterializePayload {
  return {
    projectRootPath: input.projectRootPath,
    parentTaskName: input.parentTaskName,
    cluster: input.cluster,
    childTasks: input.normalized.splitTasks.map((task) =>
      projectChildTask(task, input.cluster),
    ),
    claudeSplitMapping: input.normalized.claudeSplitMapping ?? null,
  };
}

function projectChildTask(task: TaskItem, cluster: ClusterRef): RustChildTaskPayload {
  const classification: "lightweight" | "complex" =
    task.classification === "complex" ? "complex" : "lightweight";
  const designMarkdown = task.designMarkdown?.trim();
  const implementMarkdown = task.implementMarkdown?.trim();
  return {
    sourceTaskId: task.id,
    title: task.title,
    slug: deriveSlug(task.title, task.id),
    prdMarkdown: renderChildPrd(task, cluster),
    repositoryId: cluster.primaryRepositoryId,
    clusterId: cluster.id,
    role: task.role,
    dependencies: [...task.dependencies],
    sourceRequirementIds: [...task.sourceRequirementIds],
    taskAnchors: task.taskAnchors ?? null,
    classification,
    designMarkdown: designMarkdown && designMarkdown.length > 0 ? designMarkdown : null,
    implementMarkdown: implementMarkdown && implementMarkdown.length > 0 ? implementMarkdown : null,
  };
}

/** 把任务标题归一为 ASCII slug；非 ASCII 全部转成 `-`，再以 fallbackId 兜底。 */
export function deriveSlug(title: string, fallbackId: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized;
  const fallback = fallbackId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fallback || "task";
}

/** 渲染子任务 prd.md。保留溯源所需字段（sourceRequirementIds / taskAnchors）。 */
export function renderChildPrd(task: TaskItem, cluster: ClusterRef): string {
  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  lines.push("");
  const repoSegment =
    cluster.primaryRepositoryId == null ? "null" : String(cluster.primaryRepositoryId);
  lines.push(`> cluster: \`${cluster.id}\` · repositoryId: \`${repoSegment}\` · role: \`${task.role}\``);
  lines.push("");

  if (task.description?.trim()) {
    lines.push("## Description");
    lines.push("");
    lines.push(task.description.trim());
    lines.push("");
  }

  if (task.sourceRequirementIds.length > 0) {
    lines.push("## Source requirements");
    lines.push("");
    for (const id of task.sourceRequirementIds) lines.push(`- ${id}`);
    lines.push("");
  }

  if (task.subtasks.length > 0) {
    lines.push("## Subtasks");
    lines.push("");
    for (const s of task.subtasks) lines.push(`- ${s}`);
    lines.push("");
  }

  if (task.dod.length > 0) {
    lines.push("## DoD");
    lines.push("");
    for (const d of task.dod) lines.push(`- [ ] ${d}`);
    lines.push("");
  }

  if (task.dependencies.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    for (const dep of task.dependencies) lines.push(`- ${dep}`);
    lines.push("");
  }

  if (task.taskAnchors) {
    const anchor = task.taskAnchors;
    lines.push("## Anchor");
    lines.push("");
    lines.push(`- textHash: \`${anchor.textHash}\``);
    lines.push(`- range: [${anchor.from}, ${anchor.to}]`);
    if (anchor.contextBefore.trim()) {
      lines.push(`- contextBefore: ${truncate(anchor.contextBefore.trim(), 120)}`);
    }
    if (anchor.contextAfter.trim()) {
      lines.push(`- contextAfter: ${truncate(anchor.contextAfter.trim(), 120)}`);
    }
    lines.push("");
  }

  if (task.executionStatus === "not_executable") {
    lines.push("> executionStatus: not_executable (planner-flagged missing prerequisites)");
    lines.push("");
  }

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 渲染父任务 prd.md：保留 PRD 原文 + cluster 元信息块。 */
export function renderParentPrd(prdMarkdown: string, cluster: ClusterRef): string {
  const banner =
    `<!-- cluster: ${JSON.stringify({
      id: cluster.id,
      title: cluster.title,
      primaryRepositoryId: cluster.primaryRepositoryId,
      repositoryIds: cluster.repositoryIds,
    })} -->`;
  return `${banner}\n\n${prdMarkdown.trimEnd()}\n`;
}
