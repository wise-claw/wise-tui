import { invoke } from "@tauri-apps/api/core";
import {
  CLAUDE_SPLIT_EXIT_CODE_OK,
  CLAUDE_SPLIT_EXIT_CODE_RETRYABLE,
  CLAUDE_SPLIT_EXIT_CODE_UNRECOVERABLE,
  type ClaudeSplitExitCode,
} from "../constants/claudeSplitExitCode";

export interface PrdSplitClaudeRunResult {
  runId: string;
  status: "succeeded" | "failed";
  exitCode: ClaudeSplitExitCode | number;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  notesPath: string | null;
}

export interface RunPrdSplitClaudeInput {
  projectPath: string;
  runDir: string;
  prompt: string;
  model?: string | null;
  timeoutMs?: number;
}

/** spec §5 C3：执行 Claude 拆分并落盘 stdout/stderr/raw 结果。 */
export async function runPrdSplitClaude(input: RunPrdSplitClaudeInput): Promise<PrdSplitClaudeRunResult> {
  return invoke<PrdSplitClaudeRunResult>("run_prd_split_claude", {
    projectPath: input.projectPath,
    runDir: input.runDir,
    prompt: input.prompt,
    model: input.model ?? null,
    timeoutMs: input.timeoutMs ?? null,
  });
}

/** spec §5 C2：退出码解释。 */
export function explainClaudeSplitExitCode(code: number): string {
  if (code === CLAUDE_SPLIT_EXIT_CODE_OK) return "执行成功";
  if (code === CLAUDE_SPLIT_EXIT_CODE_RETRYABLE) return "可重试错误（如超时、输出格式错误）";
  if (code === CLAUDE_SPLIT_EXIT_CODE_UNRECOVERABLE) return "不可恢复错误（如输出结构根本不符）";
  return `未知退出码(${code})`;
}
