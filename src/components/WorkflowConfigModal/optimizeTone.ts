export type OptimizeTone = "concise" | "structured" | "acceptance" | "risk";

export const WORKFLOW_NODE_OPTIMIZE_TONE_STORAGE_KEY = "wise.workflow.node.optimizeToneByField";

export const OPTIMIZE_TONE_OPTIONS: Array<{ value: OptimizeTone; label: string; prompt: string }> = [
  { value: "concise", label: "精简表达", prompt: "尽量减少冗余表达，保持信息完整。" },
  { value: "structured", label: "结构化输出", prompt: "按清晰结构组织内容，便于执行和复盘。" },
  { value: "acceptance", label: "验收导向", prompt: "强调可验证标准与可交付结果。" },
  { value: "risk", label: "风险导向", prompt: "补充边界条件、风险点与兜底策略。" },
];

export function isOptimizeTone(value: unknown): value is OptimizeTone {
  return value === "concise" || value === "structured" || value === "acceptance" || value === "risk";
}

export function buildOptimizeTonePrompt(input: {
  field: "stageTask" | "acceptanceCriteria";
  current: string;
  title: string;
  tone: OptimizeTone;
}): string {
  const tonePrompt = OPTIMIZE_TONE_OPTIONS.find((item) => item.value === input.tone)?.prompt ?? "";
  return [
    "你是工作流文案优化专家，请优化下面的内容。",
    "",
    "执行边界（必须遵守）：",
    "- 不要读取本地仓库、目录或任何文件；",
    "- 不要使用 @文件、路径探测、工具调用结果等外部上下文；",
    "- 仅基于本次输入的原始文本进行改写与优化。",
    "",
    "优化目标：",
    "1) 保留原始语义与业务目标，不改变意图；",
    "2) 提升表达清晰度、可执行性与可评估性；",
    "3) 输出必须是可直接替换的 Markdown 正文，不要解释。",
    tonePrompt ? `4) 优化风格：${tonePrompt}` : "",
    "",
    `阶段名称：${input.title || "未命名阶段"}`,
    `字段类型：${input.field === "stageTask" ? "执行任务" : "评判标准"}`,
    "",
    "原始内容：",
    "```markdown",
    input.current,
    "```",
    "",
    "请直接输出优化后的正文，不要输出代码块标记。",
  ].join("\n");
}
