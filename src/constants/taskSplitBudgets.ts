export interface TaskSplitBudgetThresholds {
  /** 关键路径允许的最大长度（任务数）。 */
  maxCriticalPathLength: number;
  /** 跨模块依赖密度上限：跨角色依赖数 / 依赖总数。 */
  maxCrossModuleDependencyDensity: number;
  /** 任务粒度方差上限：按 S=1/M=2/L=3 的方差。 */
  maxTaskGranularityVariance: number;
  /** L 级任务占比上限。 */
  maxLSizeRatio: number;
}

export const DEFAULT_TASK_SPLIT_BUDGETS: TaskSplitBudgetThresholds = {
  maxCriticalPathLength: 9,
  maxCrossModuleDependencyDensity: 0.45,
  maxTaskGranularityVariance: 0.8,
  maxLSizeRatio: 0.35,
};
