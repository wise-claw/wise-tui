import type { WorkflowGraphNode, WorkflowGraphNodeData } from "../types";
import type {
  WorkflowPromptInjectionMode,
  WorkflowPromptMessage,
  WorkflowPromptMessageRole,
  WorkflowPromptTemplateConfig,
} from "../types/workflowPrompt";
import { DEFAULT_WORKFLOW_PROMPT_CONFIG } from "../types/workflowPrompt";
import { applyWorkflowVariableSubstitution } from "../utils/workflowVariables";
import type { BranchEvaluationContext } from "./workflowBranchEvaluation";

const VALID_ROLES = new Set<WorkflowPromptMessageRole>(["system", "user", "assistant"]);

export const WORKFLOW_PROMPT_BUILTIN_VARIABLES = [
  { name: "task_content", label: "任务正文（开始输入）", sample: "请完成本次需求…" },
  { name: "last_output", label: "上阶段输出", sample: "上一阶段 Agent 的回复摘要" },
  { name: "acceptance", label: "验收结论", sample: "pass 或 reject" },
] as const;

function roleLabel(role: WorkflowPromptMessageRole): string {
  if (role === "system") return "System";
  if (role === "assistant") return "Assistant";
  return "User";
}

function normalizeMessage(raw: unknown, index: number): WorkflowPromptMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `pm-${index + 1}`;
  const role =
    typeof record.role === "string" && VALID_ROLES.has(record.role as WorkflowPromptMessageRole)
      ? (record.role as WorkflowPromptMessageRole)
      : "user";
  const content = typeof record.content === "string" ? record.content : "";
  return { id, role, content };
}

export function normalizePromptMessages(raw: unknown): WorkflowPromptMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_WORKFLOW_PROMPT_CONFIG.messages];
  const out = raw.map(normalizeMessage).filter((item): item is WorkflowPromptMessage => Boolean(item));
  return out.length > 0 ? out : [...DEFAULT_WORKFLOW_PROMPT_CONFIG.messages];
}

export function promptConfigFromNodeData(data: WorkflowGraphNodeData): WorkflowPromptTemplateConfig {
  const legacy = typeof data.promptTemplate === "string" ? data.promptTemplate.trim() : "";
  const messages = normalizePromptMessages(data.promptMessages);
  if (legacy && messages.every((m) => !m.content.trim())) {
    return {
      messages: [{ id: "pm-legacy", role: "user", content: legacy }],
      injectionMode:
        data.promptInjectionMode === "user_prefix" ? "user_prefix" : DEFAULT_WORKFLOW_PROMPT_CONFIG.injectionMode,
      requireAcknowledgement: Boolean(data.promptRequireAcknowledgement),
    };
  }
  const injectionMode: WorkflowPromptInjectionMode =
    data.promptInjectionMode === "user_prefix" ? "user_prefix" : "structured_block";
  return {
    messages,
    injectionMode,
    requireAcknowledgement: Boolean(data.promptRequireAcknowledgement),
  };
}

export function serializePromptConfigToNodeData(
  config: WorkflowPromptTemplateConfig,
): Pick<WorkflowGraphNodeData, "promptMessages" | "promptInjectionMode" | "promptRequireAcknowledgement" | "promptTemplate"> {
  const primary = config.messages.map((m) => m.content.trim()).filter(Boolean).join("\n\n");
  return {
    promptMessages: config.messages,
    promptInjectionMode: config.injectionMode,
    promptRequireAcknowledgement: config.requireAcknowledgement,
    promptTemplate: primary,
  };
}

export function substitutePromptContent(content: string, ctx: BranchEvaluationContext): string {
  let out = applyWorkflowVariableSubstitution(content, ctx.variables);
  out = out.replace(/\{\{\s*task_content\s*\}\}/gi, ctx.taskContent?.trim() ?? "");
  out = out.replace(/\$\{\s*task_content\s*\}/gi, ctx.taskContent?.trim() ?? "");
  out = out.replace(/\{\{\s*last_output\s*\}\}/gi, ctx.lastOutput?.trim() ?? "");
  out = out.replace(/\$\{\s*last_output\s*\}/gi, ctx.lastOutput?.trim() ?? "");
  out = out.replace(/\{\{\s*acceptance\s*\}\}/gi, ctx.acceptanceDecision ?? "");
  out = out.replace(/\$\{\s*acceptance\s*\}/gi, ctx.acceptanceDecision ?? "");
  return out;
}

export function renderPromptConfigBlock(
  config: WorkflowPromptTemplateConfig,
  ctx: BranchEvaluationContext,
): string {
  const parts: string[] = [];
  const activeMessages = config.messages.filter((m) => m.content.trim());
  if (activeMessages.length === 0) return "";

  if (config.injectionMode === "user_prefix") {
    const userText = activeMessages
      .filter((m) => m.role === "user")
      .map((m) => substitutePromptContent(m.content, ctx).trim())
      .filter(Boolean)
      .join("\n\n");
    if (!userText) return "";
    parts.push("【提示词模板 · 前缀】", userText);
  } else {
    parts.push("【提示词模板 · 多段消息】");
    activeMessages.forEach((message, index) => {
      const body = substitutePromptContent(message.content, ctx).trim();
      if (!body) return;
      parts.push("", `### ${index + 1}. ${roleLabel(message.role)}`, "", body);
    });
  }

  if (config.requireAcknowledgement) {
    parts.push(
      "",
      "【模板确认要求】",
      "在执行本阶段任务前，请在回复开头用 1～2 句话确认你已理解上述模板约束，然后再展开具体工作。",
    );
  }

  return parts.join("\n").trim();
}

export function formatPromptPassthroughBlockFromNode(node: WorkflowGraphNode, ctx: BranchEvaluationContext): string {
  const config = promptConfigFromNodeData(node.data);
  return renderPromptConfigBlock(config, ctx);
}

export function previewPromptConfig(
  config: WorkflowPromptTemplateConfig,
  ctx: BranchEvaluationContext,
): string {
  return renderPromptConfigBlock(config, ctx) || "（模板为空或未配置有效消息）";
}

export function summarizePromptConfig(config: WorkflowPromptTemplateConfig): string {
  const active = config.messages.filter((m) => m.content.trim());
  if (active.length === 0) return "未配置模板";
  const first = active[0].content.trim();
  const preview = first.length > 40 ? `${first.slice(0, 40)}…` : first;
  const roles = [...new Set(active.map((m) => roleLabel(m.role)))].join("+");
  return `${roles} · ${preview}`;
}
