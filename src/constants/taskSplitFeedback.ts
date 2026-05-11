/** 用户对拆分结果的结构化反馈标签（用于 Claude 深化定向纠偏与进化日志）。 */
export const TASK_SPLIT_FEEDBACK_TAGS = [
  { id: "granularity", label: "粒度不当（过大/过小）" },
  { id: "dependency", label: "依赖顺序/关系不对" },
  { id: "missing_coverage", label: "遗漏需求或未覆盖" },
  { id: "naming", label: "任务命名不清晰" },
  { id: "dod", label: "DoD/子任务不具体" },
  { id: "parallelism", label: "关键路径/并行组不合理" },
  { id: "other", label: "其他" },
] as const;

export type TaskSplitFeedbackTagId = (typeof TASK_SPLIT_FEEDBACK_TAGS)[number]["id"];
