import type { WorkflowStageOutcomeCriterion } from "../types";

/**
 * 将节点上的 `stageSuccessCriteria` 规范为「名称 + 要求」对象数组。
 * 兼容历史数据：元素为 string 时视为仅要求（Markdown），名称自动生成占位。
 */
export function normalizeWorkflowStageOutcomeCriteria(raw: unknown): WorkflowStageOutcomeCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowStageOutcomeCriterion[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const requirement = item.trim();
      if (!requirement) continue;
      out.push({ name: "", requirement });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const requirement =
        typeof o.requirement === "string"
          ? o.requirement.trim()
          : typeof o.markdown === "string"
            ? o.markdown.trim()
            : "";
      if (!requirement) continue;
      out.push({ name, requirement });
    }
  }
  return out;
}
