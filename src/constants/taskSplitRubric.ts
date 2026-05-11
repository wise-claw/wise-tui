export type TaskSplitRubricEvaluationKind = "auto" | "model" | "manual";

export interface TaskSplitRubricRule {
  id: string;
  title: string;
  evaluation: TaskSplitRubricEvaluationKind;
  hint: string;
}

/** Rubric 规则目录：用于统一自动校验、模型批评家与人工评审边界。 */
export const TASK_SPLIT_RUBRIC_RULES: TaskSplitRubricRule[] = [
  { id: "dep_cycle", title: "依赖不能成环", evaluation: "auto", hint: "检测依赖图 cycle" },
  { id: "dep_unknown", title: "依赖 id 必须存在", evaluation: "auto", hint: "依赖指向有效任务" },
  { id: "req_uncovered", title: "需求需要被任务覆盖", evaluation: "auto", hint: "requirements 至少映射一次" },
  { id: "size_l", title: "避免保留 L 粒度任务", evaluation: "auto", hint: "L 任务应继续拆分" },
  { id: "critical_path", title: "关键路径合理", evaluation: "model", hint: "避免明显逆序或阻塞" },
  { id: "parallelism", title: "并行组划分合理", evaluation: "model", hint: "可并行任务应被识别" },
  { id: "dod_quality", title: "DoD 可验证", evaluation: "manual", hint: "验收项明确、可执行" },
  { id: "naming_clear", title: "任务命名清晰", evaluation: "manual", hint: "标题具体且可交付" },
];

export function buildRubricRulesPromptSection(): string {
  const lines = TASK_SPLIT_RUBRIC_RULES.map(
    (r) => `- ${r.id} | ${r.evaluation} | ${r.title} | ${r.hint}`,
  );
  return ["Rubric 规则目录（id | 评估类型 | 标题 | 说明）：", ...lines].join("\n");
}
