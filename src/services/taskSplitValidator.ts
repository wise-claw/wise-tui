import type { PrdSplitMappingPayload, SplitResult, TaskItem } from "../types";
import { DEFAULT_TASK_SPLIT_BUDGETS, type TaskSplitBudgetThresholds } from "../constants/taskSplitBudgets";
import { listPrdRequirementIndexEntries } from "./prdRequirementIndex";
import { buildIdRemapMap } from "./splitMappingMerge";

export type SplitValidationSeverity = "error" | "warning";

export interface SplitValidationIssue {
  code: string;
  severity: SplitValidationSeverity;
  message: string;
  taskId?: string;
  metric?: {
    name: "criticalPathLength" | "crossModuleDependencyDensity" | "taskGranularityVariance" | "lSizeRatio";
    value: number;
    budget: number;
  };
}

export type SplitMergeDecision = "block" | "warn" | "allow";

export interface SplitValidationReport {
  mergeDecision: SplitMergeDecision;
  hardErrors: SplitValidationIssue[];
  softWarnings: SplitValidationIssue[];
  issues?: SplitValidationIssue[];
  errors?: SplitValidationIssue[];
  warnings?: SplitValidationIssue[];
}

function applyRemapId(id: string, remap: Map<string, string>): string {
  return remap.get(id) ?? id;
}

/** 依赖图：从任务指向其前置依赖，用于环检测与缺失引用检查。 */
function collectDependencyGraphIssues(tasks: TaskItem[]): SplitValidationIssue[] {
  const issues: SplitValidationIssue[] = [];
  const idSet = new Set(tasks.map((t) => t.id));

  for (const t of tasks) {
    const seen = new Set<string>();
    for (const d of t.dependencies) {
      if (!idSet.has(d)) {
        issues.push({
          code: "dep_unknown",
          severity: "error",
          message: `任务 ${t.id} 依赖了不存在的任务 id：${d}`,
          taskId: t.id,
        });
      }
      if (d === t.id) {
        issues.push({
          code: "dep_self",
          severity: "error",
          message: `任务 ${t.id} 不能依赖自身`,
          taskId: t.id,
        });
      }
      if (seen.has(d)) {
        issues.push({
          code: "dep_dup",
          severity: "warning",
          message: `任务 ${t.id} 的依赖列表中存在重复项：${d}`,
          taskId: t.id,
        });
      }
      seen.add(d);
    }
  }

  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    adj.set(t.id, t.dependencies.filter((d) => idSet.has(d) && d !== t.id));
  }

  const color = new Map<string, number>();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  for (const t of tasks) color.set(t.id, WHITE);

  function visit(u: string): string | null {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) return v;
      if (c === WHITE) {
        const cycle = visit(v);
        if (cycle) return cycle;
      }
    }
    color.set(u, BLACK);
    return null;
  }

  for (const t of tasks) {
    if (color.get(t.id) === WHITE) {
      const hit = visit(t.id);
      if (hit) {
        issues.push({
          code: "dep_cycle",
          severity: "error",
          message: `任务依赖存在环（涉及 ${hit} 等）`,
          taskId: t.id,
        });
        break;
      }
    }
  }

  return issues;
}

/** sourceRequirementIds 须全部出现在当前 PRD 需求索引中（spec §4 I1 / §6）。 */
function collectRequirementReferenceIssues(result: SplitResult): SplitValidationIssue[] {
  const reqEntries = listPrdRequirementIndexEntries(result.source);
  const allReqIds = new Set(reqEntries.map((e) => e.id));
  const issues: SplitValidationIssue[] = [];
  for (const t of result.splitTasks) {
    for (const rid of t.sourceRequirementIds ?? []) {
      if (!allReqIds.has(rid)) {
        issues.push({
          code: "req_unknown_ref",
          severity: "error",
          message: `任务 ${t.id} 的 sourceRequirementIds 含不存在的需求 id：${rid}`,
          taskId: t.id,
        });
      }
    }
  }
  return issues;
}

function collectRubricWarnings(result: SplitResult): SplitValidationIssue[] {
  const issues: SplitValidationIssue[] = [];
  for (const t of result.splitTasks) {
    if (t.size === "L") {
      issues.push({
        code: "size_l",
        severity: "warning",
        message: `任务 ${t.id} 仍为 L 级，按约定应继续拆分`,
        taskId: t.id,
      });
    }
    if (t.subtasks.length === 0) {
      issues.push({
        code: "subtasks_empty",
        severity: "warning",
        message: `任务 ${t.id} 缺少子任务`,
        taskId: t.id,
      });
    }
    if (t.dod.length === 0) {
      issues.push({
        code: "dod_empty",
        severity: "warning",
        message: `任务 ${t.id} 缺少 DoD`,
        taskId: t.id,
      });
    }
  }

  const reqEntries = listPrdRequirementIndexEntries(result.source);
  const allReqIds = new Set(reqEntries.map((e) => e.id));
  const covered = new Set<string>();
  for (const t of result.splitTasks) {
    for (const rid of t.sourceRequirementIds ?? []) {
      if (allReqIds.has(rid)) covered.add(rid);
    }
  }
  for (const e of reqEntries) {
    if (!covered.has(e.id)) {
      issues.push({
        code: "req_uncovered",
        severity: "warning",
        message: `需求未映射到任何任务：${e.id}（${e.label}）`,
      });
    }
  }

  return issues;
}

function toSizeScore(size: TaskItem["size"]): number {
  if (size === "S") return 1;
  if (size === "M") return 2;
  return 3;
}

function computeTaskGranularityVariance(tasks: TaskItem[]): number {
  if (tasks.length === 0) return 0;
  const values = tasks.map((task) => toSizeScore(task.size));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return variance;
}

function computeCrossModuleDependencyDensity(tasks: TaskItem[]): number {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let totalDependencies = 0;
  let crossModuleDependencies = 0;
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      const dep = byId.get(depId);
      if (!dep) continue;
      totalDependencies += 1;
      if (dep.role !== task.role) {
        crossModuleDependencies += 1;
      }
    }
  }
  if (totalDependencies === 0) return 0;
  return crossModuleDependencies / totalDependencies;
}

function collectSoftBudgetWarnings(
  result: SplitResult,
  budgets: TaskSplitBudgetThresholds,
): SplitValidationIssue[] {
  const issues: SplitValidationIssue[] = [];
  const criticalPathLength = result.criticalPath.length;
  if (criticalPathLength > budgets.maxCriticalPathLength) {
    issues.push({
      code: "budget_critical_path_length",
      severity: "warning",
      message: `关键路径过长：当前 ${criticalPathLength}，预算上限 ${budgets.maxCriticalPathLength}`,
      metric: {
        name: "criticalPathLength",
        value: criticalPathLength,
        budget: budgets.maxCriticalPathLength,
      },
    });
  }

  const crossModuleDependencyDensity = computeCrossModuleDependencyDensity(result.splitTasks);
  if (crossModuleDependencyDensity > budgets.maxCrossModuleDependencyDensity) {
    issues.push({
      code: "budget_cross_module_dependency_density",
      severity: "warning",
      message: `跨模块依赖密度偏高：当前 ${crossModuleDependencyDensity.toFixed(2)}，预算上限 ${budgets.maxCrossModuleDependencyDensity.toFixed(2)}`,
      metric: {
        name: "crossModuleDependencyDensity",
        value: crossModuleDependencyDensity,
        budget: budgets.maxCrossModuleDependencyDensity,
      },
    });
  }

  const taskGranularityVariance = computeTaskGranularityVariance(result.splitTasks);
  if (taskGranularityVariance > budgets.maxTaskGranularityVariance) {
    issues.push({
      code: "budget_task_granularity_variance",
      severity: "warning",
      message: `任务粒度方差偏高：当前 ${taskGranularityVariance.toFixed(2)}，预算上限 ${budgets.maxTaskGranularityVariance.toFixed(2)}`,
      metric: {
        name: "taskGranularityVariance",
        value: taskGranularityVariance,
        budget: budgets.maxTaskGranularityVariance,
      },
    });
  }

  const lSizeRatio = result.splitTasks.length === 0
    ? 0
    : result.splitTasks.filter((task) => task.size === "L").length / result.splitTasks.length;
  if (lSizeRatio > budgets.maxLSizeRatio) {
    issues.push({
      code: "budget_l_size_ratio",
      severity: "warning",
      message: `L 级任务占比偏高：当前 ${lSizeRatio.toFixed(2)}，预算上限 ${budgets.maxLSizeRatio.toFixed(2)}`,
      metric: {
        name: "lSizeRatio",
        value: lSizeRatio,
        budget: budgets.maxLSizeRatio,
      },
    });
  }

  return issues;
}

/** 对当前拆分结果做 Rubric 校验（依赖完整性、无环、覆盖度等）。 */
export function validateSplitResult(
  result: SplitResult,
  options?: { budgets?: TaskSplitBudgetThresholds },
): SplitValidationReport {
  const budgets = options?.budgets ?? DEFAULT_TASK_SPLIT_BUDGETS;
  const issues = [
    ...collectDependencyGraphIssues(result.splitTasks),
    ...collectRequirementReferenceIssues(result),
    ...collectRubricWarnings(result),
    ...collectSoftBudgetWarnings(result, budgets),
  ];
  const hardErrors = issues.filter((i) => i.severity === "error");
  const softWarnings = issues.filter((i) => i.severity === "warning");
  const mergeDecision: SplitMergeDecision = hardErrors.length > 0
    ? "block"
    : softWarnings.length > 0
      ? "warn"
      : "allow";
  return {
    mergeDecision,
    hardErrors,
    softWarnings,
    // 兼容旧调用方字段
    issues,
    errors: hardErrors,
    warnings: softWarnings,
  };
}

/**
 * 校验 Claude 返回的 `split-mapping.json` 是否可安全合并（任务 id 存在性等）。
 * requirement id 非法由合并阶段忽略并告警，此处仅对完全无有效 link 给出 warning。
 */
export function validateSplitMappingPayload(
  result: SplitResult,
  mapping: PrdSplitMappingPayload,
): SplitValidationReport {
  const issues: SplitValidationIssue[] = [];
  const remap = buildIdRemapMap(mapping.idRemap);
  const taskIds = new Set(result.splitTasks.map((t) => applyRemapId(t.id, remap)));

  for (const link of mapping.taskRequirementLinks) {
    const tid = applyRemapId(link.taskId, remap);
    if (!taskIds.has(tid)) {
      issues.push({
        code: "map_unknown_task",
        severity: "error",
        message: `映射引用了不存在的任务：taskId=${link.taskId}（解析后 ${tid}）`,
        taskId: link.taskId,
      });
    }
  }

  if (mapping.taskRequirementLinks.length === 0 && !(mapping.idRemap?.length)) {
    issues.push({
      code: "map_empty",
      severity: "warning",
      message: "映射为空且无 idRemap，合并后任务列表不会变化",
    });
  }

  const hardErrors = issues.filter((i) => i.severity === "error");
  const softWarnings = issues.filter((i) => i.severity === "warning");
  const mergeDecision: SplitMergeDecision = hardErrors.length > 0
    ? "block"
    : softWarnings.length > 0
      ? "warn"
      : "allow";
  return {
    mergeDecision,
    hardErrors,
    softWarnings,
    issues,
    errors: hardErrors,
    warnings: softWarnings,
  };
}
