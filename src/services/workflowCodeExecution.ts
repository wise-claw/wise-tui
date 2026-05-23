import type { WorkflowGraphNode, WorkflowGraphNodeData } from "../types";
import type {
  WorkflowCodeExecutionConfig,
  WorkflowCodeExecutionMode,
  WorkflowCodeInputBinding,
  WorkflowCodeLanguage,
  WorkflowCodeOutputVariable,
} from "../types/workflowCode";
import { DEFAULT_WORKFLOW_CODE_CONFIG } from "../types/workflowCode";
import type { BranchEvaluationContext } from "./workflowBranchEvaluation";
import { substitutePromptContent } from "./workflowPromptTemplate";

const VALID_MODES = new Set<WorkflowCodeExecutionMode>(["command", "script"]);
const VALID_LANGUAGES = new Set<WorkflowCodeLanguage>(["shell", "javascript", "typescript", "python", "rust"]);

export const WORKFLOW_CODE_BUILTIN_VARIABLES = [
  { name: "task_content", label: "任务正文（开始输入）" },
  { name: "last_output", label: "上阶段输出" },
  { name: "acceptance", label: "验收结论" },
] as const;

export const WORKFLOW_CODE_LANGUAGE_OPTIONS: { value: WorkflowCodeLanguage; label: string; monaco: string; fence: string }[] = [
  { value: "shell", label: "Shell / Bash", monaco: "shell", fence: "bash" },
  { value: "javascript", label: "JavaScript", monaco: "javascript", fence: "javascript" },
  { value: "typescript", label: "TypeScript", monaco: "typescript", fence: "typescript" },
  { value: "python", label: "Python", monaco: "python", fence: "python" },
  { value: "rust", label: "Rust", monaco: "rust", fence: "rust" },
];

function languageMeta(language: WorkflowCodeLanguage) {
  return WORKFLOW_CODE_LANGUAGE_OPTIONS.find((item) => item.value === language) ?? WORKFLOW_CODE_LANGUAGE_OPTIONS[0];
}

function normalizeInputBinding(raw: unknown, index: number): WorkflowCodeInputBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `cb-in-${index + 1}`;
  const source = typeof record.source === "string" ? record.source.trim() : "";
  const target = typeof record.target === "string" ? record.target.trim() : "";
  if (!source || !target) return null;
  return { id, source, target };
}

function normalizeOutputVariable(raw: unknown, index: number): WorkflowCodeOutputVariable | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `cb-out-${index + 1}`;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const description = typeof record.description === "string" ? record.description.trim() : undefined;
  return { id, name, ...(description ? { description } : {}) };
}

export function normalizeCodeInputBindings(raw: unknown): WorkflowCodeInputBinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeInputBinding).filter((item): item is WorkflowCodeInputBinding => Boolean(item));
}

export function normalizeCodeOutputVariables(raw: unknown): WorkflowCodeOutputVariable[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeOutputVariable).filter((item): item is WorkflowCodeOutputVariable => Boolean(item));
}

function inferLegacyMode(script: string): WorkflowCodeExecutionMode {
  if (!script.trim()) return "command";
  if (script.includes("\n")) return "script";
  if (/^(def |class |import |from |function |const |let |async |fn |pub |use )/m.test(script)) return "script";
  return "command";
}

export function codeConfigFromNodeData(data: WorkflowGraphNodeData): WorkflowCodeExecutionConfig {
  const legacy = typeof data.codeScript === "string" ? data.codeScript.trim() : "";
  const hasExtended =
    typeof data.codeSource === "string" ||
    data.codeMode != null ||
    data.codeLanguage != null ||
    Array.isArray(data.codeInputBindings) ||
    Array.isArray(data.codeOutputVariables);

  if (!hasExtended && legacy) {
    return {
      ...DEFAULT_WORKFLOW_CODE_CONFIG,
      mode: inferLegacyMode(legacy),
      language: "shell",
      source: legacy,
    };
  }

  const mode =
    typeof data.codeMode === "string" && VALID_MODES.has(data.codeMode as WorkflowCodeExecutionMode)
      ? (data.codeMode as WorkflowCodeExecutionMode)
      : DEFAULT_WORKFLOW_CODE_CONFIG.mode;
  const language =
    typeof data.codeLanguage === "string" && VALID_LANGUAGES.has(data.codeLanguage as WorkflowCodeLanguage)
      ? (data.codeLanguage as WorkflowCodeLanguage)
      : DEFAULT_WORKFLOW_CODE_CONFIG.language;
  const source =
    typeof data.codeSource === "string" && data.codeSource.trim()
      ? data.codeSource
      : legacy || DEFAULT_WORKFLOW_CODE_CONFIG.source;
  const workingDirectory =
    typeof data.codeWorkingDirectory === "string" ? data.codeWorkingDirectory.trim() : undefined;
  const timeoutRaw = data.codeTimeoutSeconds;
  const timeoutSeconds =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : undefined;

  return {
    mode,
    language,
    source,
    inputBindings: normalizeCodeInputBindings(data.codeInputBindings),
    outputVariables: normalizeCodeOutputVariables(data.codeOutputVariables),
    requireStructuredOutput: Boolean(data.codeRequireStructuredOutput),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
  };
}

export function serializeCodeConfigToNodeData(
  config: WorkflowCodeExecutionConfig,
): Pick<
  WorkflowGraphNodeData,
  | "codeScript"
  | "codeMode"
  | "codeLanguage"
  | "codeSource"
  | "codeInputBindings"
  | "codeOutputVariables"
  | "codeRequireStructuredOutput"
  | "codeWorkingDirectory"
  | "codeTimeoutSeconds"
> {
  const primary = config.source.trim();
  const workingDirectory = config.workingDirectory?.trim();
  return {
    codeScript: primary,
    codeMode: config.mode,
    codeLanguage: config.language,
    codeSource: config.source,
    codeInputBindings: config.inputBindings,
    codeOutputVariables: config.outputVariables,
    codeRequireStructuredOutput: config.requireStructuredOutput,
    ...(workingDirectory ? { codeWorkingDirectory: workingDirectory } : {}),
    ...(config.timeoutSeconds && config.timeoutSeconds > 0 ? { codeTimeoutSeconds: config.timeoutSeconds } : {}),
  };
}

function resolveBindingValue(source: string, ctx: BranchEvaluationContext): string {
  const fromVars = ctx.variables?.[source];
  if (fromVars != null && String(fromVars).trim()) return String(fromVars).trim();
  if (source === "task_content") return ctx.taskContent?.trim() ?? "";
  if (source === "last_output") return ctx.lastOutput?.trim() ?? "";
  if (source === "acceptance") return ctx.acceptanceDecision ?? "";
  return "";
}

export function substituteCodeSource(source: string, config: WorkflowCodeExecutionConfig, ctx: BranchEvaluationContext): string {
  let out = substitutePromptContent(source, ctx);
  for (const binding of config.inputBindings) {
    const value = resolveBindingValue(binding.source, ctx);
    const target = binding.target.trim();
    if (!target) continue;
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(target)}\\s*\\}\\}`, "gi");
    out = out.replace(pattern, value);
    const dollarPattern = new RegExp(`\\$\\{\\s*${escapeRegExp(target)}\\s*\\}`, "gi");
    out = out.replace(dollarPattern, value);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modeLabel(mode: WorkflowCodeExecutionMode): string {
  return mode === "command" ? "Shell 命令" : "脚本片段";
}

export function renderCodeExecutionBlock(config: WorkflowCodeExecutionConfig, ctx: BranchEvaluationContext): string {
  const source = substituteCodeSource(config.source, config, ctx).trim();
  if (!source) return "";

  const meta = languageMeta(config.language);
  const lines = [`【代码执行 · ${modeLabel(config.mode)} · ${meta.label}】`];

  if (config.workingDirectory?.trim()) {
    lines.push(`工作目录（相对仓库根）：${config.workingDirectory.trim()}`);
  }
  if (config.timeoutSeconds && config.timeoutSeconds > 0) {
    lines.push(`建议超时：${config.timeoutSeconds} 秒`);
  }

  if (config.inputBindings.length > 0) {
    lines.push("", "输入变量映射：");
    config.inputBindings.forEach((binding) => {
      const sample = resolveBindingValue(binding.source, ctx);
      const resolved = sample ? ` → 当前值「${sample.slice(0, 80)}${sample.length > 80 ? "…" : ""}」` : "";
      lines.push(`- ${binding.target} ← {{${binding.source}}}${resolved}`);
    });
  }

  if (config.outputVariables.length > 0) {
    lines.push("", "预期输出变量（请在回复中报告）：");
    config.outputVariables.forEach((item) => {
      const desc = item.description?.trim() ? `：${item.description.trim()}` : "";
      lines.push(`- ${item.name}${desc}`);
    });
  }

  lines.push(
    "",
    "请在受控环境中执行以下内容，并将 stdout / stderr 摘要与关键结论写入回复。",
    "",
    `\`\`\`${meta.fence}`,
    source,
    "```",
  );

  if (config.requireStructuredOutput && config.outputVariables.length > 0) {
    const names = config.outputVariables.map((item) => item.name).join(", ");
    lines.push(
      "",
      "【结构化输出要求】",
      `执行完成后，请用 JSON 代码块报告输出变量：{ ${names} }。`,
    );
  }

  return lines.join("\n").trim();
}

export function formatCodePassthroughBlockFromNode(node: WorkflowGraphNode, ctx: BranchEvaluationContext): string {
  const config = codeConfigFromNodeData(node.data);
  const label = (node.data.label || node.id).trim() || node.id;
  const body = renderCodeExecutionBlock(config, ctx);
  if (!body) {
    return [`【代码/脚本执行说明】`, `节点「${label}」：未配置可执行内容。`].join("\n");
  }
  return [`节点「${label}」`, "", body].join("\n");
}

export function previewCodeConfig(config: WorkflowCodeExecutionConfig, ctx: BranchEvaluationContext): string {
  return renderCodeExecutionBlock(config, ctx) || "（未配置命令或脚本）";
}

export function summarizeCodeConfig(config: WorkflowCodeExecutionConfig): string {
  const source = config.source.trim();
  if (!source) return "未配置脚本";
  const preview = source.length > 36 ? `${source.slice(0, 36)}…` : source;
  const lang = languageMeta(config.language).label;
  const outs = config.outputVariables.length > 0 ? ` · 输出 ${config.outputVariables.length}` : "";
  return `${modeLabel(config.mode)} · ${lang} · ${preview}${outs}`;
}

export function monacoLanguageForCodeConfig(config: Pick<WorkflowCodeExecutionConfig, "mode" | "language">): string {
  if (config.mode === "command") return "shell";
  return languageMeta(config.language).monaco;
}
