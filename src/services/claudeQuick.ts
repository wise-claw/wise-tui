import { invoke } from "@tauri-apps/api/core";

export interface RunClaudeQuickInput {
  projectPath: string;
  prompt: string;
  timeoutMs?: number;
  model?: string;
}

/** 单次 Claude Code bare 调用，供工作流字段优化、语音润色等轻量场景。 */
export async function runClaudeQuick(input: RunClaudeQuickInput): Promise<string> {
  return invoke<string>("run_claude_quick", {
    projectPath: input.projectPath,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs ?? null,
    model: input.model ?? null,
  });
}
