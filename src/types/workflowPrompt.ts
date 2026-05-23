export type WorkflowPromptMessageRole = "system" | "user" | "assistant";

export interface WorkflowPromptMessage {
  id: string;
  role: WorkflowPromptMessageRole;
  content: string;
}

/** 模板注入下游 Agent 派发输入的方式 */
export type WorkflowPromptInjectionMode = "structured_block" | "user_prefix";

export interface WorkflowPromptTemplateConfig {
  messages: WorkflowPromptMessage[];
  injectionMode: WorkflowPromptInjectionMode;
  /** 要求执行阶段在回复开头简要确认已理解模板约束 */
  requireAcknowledgement: boolean;
}

export const DEFAULT_WORKFLOW_PROMPT_MESSAGE: WorkflowPromptMessage = {
  id: "pm-user-1",
  role: "user",
  content: "",
};

export const DEFAULT_WORKFLOW_PROMPT_CONFIG: WorkflowPromptTemplateConfig = {
  messages: [{ ...DEFAULT_WORKFLOW_PROMPT_MESSAGE }],
  injectionMode: "structured_block",
  requireAcknowledgement: false,
};
