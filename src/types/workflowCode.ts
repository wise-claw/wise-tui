export type WorkflowCodeExecutionMode = "command" | "script";

export type WorkflowCodeLanguage = "shell" | "javascript" | "typescript" | "python" | "rust";

export interface WorkflowCodeInputBinding {
  id: string;
  /** 工作流变量名或内置变量 task_content / last_output / acceptance */
  source: string;
  /** 在脚本/命令中使用的占位符名，对应 {{target}} */
  target: string;
}

export interface WorkflowCodeOutputVariable {
  id: string;
  name: string;
  description?: string;
}

export interface WorkflowCodeExecutionConfig {
  mode: WorkflowCodeExecutionMode;
  language: WorkflowCodeLanguage;
  /** Shell 命令或脚本正文 */
  source: string;
  inputBindings: WorkflowCodeInputBinding[];
  outputVariables: WorkflowCodeOutputVariable[];
  /** 要求 Agent 按输出变量结构报告执行结果 */
  requireStructuredOutput: boolean;
  /** 相对仓库根目录的工作目录提示 */
  workingDirectory?: string;
  /** 超时秒数提示（仅说明，不由 Wise 强制执行） */
  timeoutSeconds?: number;
}

export const DEFAULT_WORKFLOW_CODE_CONFIG: WorkflowCodeExecutionConfig = {
  mode: "command",
  language: "shell",
  source: "",
  inputBindings: [],
  outputVariables: [],
  requireStructuredOutput: false,
};
