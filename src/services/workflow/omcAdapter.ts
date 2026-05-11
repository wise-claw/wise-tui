import type { OmcWorkflowAdapter } from "../../types/workflow";
import { executeClaudeCodeAndWait, type ClaudeInvocationResult } from "../claude";
import { gitWorktreeAddOmcBatch } from "../git";

type OmcTemplateId = "autopilot" | "ultraqa" | "verify" | "team";

interface OmcTemplateProfile {
  templateId: OmcTemplateId;
  omcCommand: string;
}

const TEMPLATE_PROFILES: Record<OmcTemplateId, OmcTemplateProfile> = {
  autopilot: { templateId: "autopilot", omcCommand: "/autopilot" },
  ultraqa: { templateId: "ultraqa", omcCommand: "/ultraqa" },
  verify: { templateId: "verify", omcCommand: "/verify" },
  team: { templateId: "team", omcCommand: "/team" },
};

function resolveTemplateProfile(templateId: string): OmcTemplateProfile {
  if (templateId in TEMPLATE_PROFILES) {
    return TEMPLATE_PROFILES[templateId as OmcTemplateId];
  }
  return { templateId: "autopilot", omcCommand: "/autopilot" };
}

/** Wise 已在宿主侧 `git worktree add`，Claude Code 的 cwd 即该目录。 */
export interface HostPreparedOmcWorktree {
  worktreePath: string;
  branchName: string;
}

export interface BuildOmcClaudeCodeInvocationPromptOptions {
  /** 保留供调用方类型兼容；提示词仅含 OMC 指令与任务正文，不再注入 worktree/Git 说明。 */
  hostPreparedWorktree?: HostPreparedOmcWorktree;
  /** 保留供调用方类型兼容；提示词不再展开 Git 约束文案。 */
  noGitWritesInSession?: boolean;
}

/**
 * 发给 Claude Code 的 `-p` 正文：首行斜杠指令，空行后为任务句（须换行分隔，否则 CLI 常丢弃指令后的正文）。
 * 无附录时仅斜杠指令。
 */
export function buildOmcClaudeCodeInvocationPrompt(
  input: {
    workflowRunId: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    attempt: number;
    /** 极简任务句（如 `buildOmcBatchTaskIntentOneLiner`） */
    taskPromptAppendix?: string;
  },
  _options?: BuildOmcClaudeCodeInvocationPromptOptions,
): string {
  const profile = resolveTemplateProfile(input.templateId);
  const cmd = profile.omcCommand;
  const extra = input.taskPromptAppendix?.trim();
  if (!extra) return cmd;
  const body = extra.replace(/\s+/g, " ").trim();
  return `${cmd}\n\n${body}`;
}

/** 直接调用 `executeClaudeCodeAndWait`（不经工作流引擎）时，根据子进程输出归类单条任务结果。 */
export function classifyOmcInvocationOutcome(result: ClaudeInvocationResult): "done" | "blocked" | "failed" {
  if (!result.success) return "failed";
  const lines =
    result.outputLines.length <= TAIL_LINES_FOR_OMC_RESULT_CLASSIFY
      ? result.outputLines
      : result.outputLines.slice(-TAIL_LINES_FOR_OMC_RESULT_CLASSIFY);
  const transcript = extractTranscriptText(lines);
  const omc = extractOmcResult(transcript);
  if (omc === "blocked") return "blocked";
  if (omc === "failed") return "failed";
  return "done";
}

export class ClaudeOmcWorkflowAdapter implements OmcWorkflowAdapter {
  async execute(input: {
    workflowRunId: string;
    repositoryPath: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    attempt: number;
  }): ReturnType<OmcWorkflowAdapter["execute"]> {
    const startedAt = Date.now();
    const profile = resolveTemplateProfile(input.templateId);
    try {
      const wt = await gitWorktreeAddOmcBatch(input.repositoryPath, input.taskId, input.attempt);
      const prompt = buildOmcClaudeCodeInvocationPrompt(input, {
        hostPreparedWorktree: { worktreePath: wt.worktreePath, branchName: wt.branchName },
      });
      const invocation = await executeClaudeCodeAndWait({
        repositoryPath: wt.worktreePath,
        prompt,
        connectionMode: "oneshot",
        bare: true,
        timeoutMs: 180_000,
        streamUi: {
          sessionId: input.sessionId,
          repositoryPath: input.repositoryPath,
          taskId: input.taskId,
          templateId: input.templateId,
          attempt: input.attempt,
          omcInvocationSource: "workflow",
        },
      });
      /** 工作流路径不解析子进程 stdout（无 transcript / OMC_RESULT / 启发式扫描）。 */
      const progressSignals = [
        {
          stage: "adapter.command.dispatched",
          message: `dispatch ${profile.omcCommand}`,
          level: "info" as const,
          metadata: { templateId: profile.templateId, omcCommand: profile.omcCommand },
        },
      ];
      const baseArtifacts = [
        `omc://${profile.templateId}/${input.taskId}/attempt-${input.attempt}`,
        `omc-command://${profile.omcCommand.replace("/", "")}`,
        `repo://${input.repositoryPath}`,
      ];
      const artifactRefs = uniqueArtifacts(baseArtifacts);
      const artifactRecords = artifactRefs.map((ref) => ({
        ref,
        artifactType: artifactTypeFromRef(ref),
      }));
      const isSuccess = invocation.success;
      if (!isSuccess) {
        const errorMessage = invocation.errorLines.join("\n").trim() || "OMC invocation failed";
        return {
          status: "failed" as const,
          artifactRefs: [
            `omc-error://${profile.templateId}/${input.taskId}/attempt-${input.attempt}`,
            ...artifactRefs,
          ],
          progressSignals,
          artifactRecords: [
            { ref: `omc-error://${profile.templateId}/${input.taskId}/attempt-${input.attempt}`, artifactType: "omc-error" },
            ...artifactRecords,
          ],
          summary: `OMC ${profile.omcCommand} failed`,
          error: {
            code: "WF_TASK_EXEC_FAILED",
            message: `OMC 执行失败: ${errorMessage}`,
            retryable: Date.now() - startedAt < 15_000,
            details: {
              templateId: profile.templateId,
              omcCommand: profile.omcCommand,
              subagentType: input.subagentType ?? "executor",
            },
          },
        };
      }
      return {
        status: "succeeded" as const,
        artifactRefs,
        progressSignals,
        artifactRecords,
        summary: `OMC ${profile.omcCommand} executed (${input.subagentType ?? "executor"})`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "failed" as const,
        artifactRefs: [
          `omc-error://${profile.templateId}/${input.taskId}/attempt-${input.attempt}`,
          `omc-command://${profile.omcCommand.replace("/", "")}`,
        ],
        summary: `OMC ${profile.omcCommand} failed`,
        error: {
          code: "WF_TASK_EXEC_FAILED",
          message: `OMC 执行失败: ${message}`,
          retryable: Date.now() - startedAt < 15_000,
          details: {
            templateId: profile.templateId,
            omcCommand: profile.omcCommand,
            subagentType: input.subagentType ?? "executor",
          },
        },
      };
    }
  }
}

/** 归类 outcome 时只扫尾部行，避免与全量 transcript 同等量级的 JSON.parse。 */
const TAIL_LINES_FOR_OMC_RESULT_CLASSIFY = 900;

/** 流式子进程单行极多时，全量 JSON.parse + 巨型 transcript 正则会在主线程卡死数秒。 */
const MAX_LINES_FOR_OMC_TRANSCRIPT = 2400;
const HEAD_LINES_FOR_OMC_TRANSCRIPT = 1200;
const TAIL_LINES_FOR_OMC_TRANSCRIPT = 1200;
const MAX_CHARS_FOR_OMC_RESULT_TAIL = 192_000;

function selectLinesForOmcTranscript(lines: string[]): string[] {
  if (lines.length <= MAX_LINES_FOR_OMC_TRANSCRIPT) return lines;
  return [...lines.slice(0, HEAD_LINES_FOR_OMC_TRANSCRIPT), ...lines.slice(-TAIL_LINES_FOR_OMC_TRANSCRIPT)];
}

function extractTranscriptText(lines: string[]): string {
  const chunks: string[] = [];
  for (const line of selectLinesForOmcTranscript(lines)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === "result") {
        const resultText =
          typeof parsed.result === "string"
            ? parsed.result
            : typeof parsed.output === "string"
              ? parsed.output
              : "";
        if (resultText) chunks.push(resultText);
        continue;
      }
      const deltaText =
        typeof (parsed.delta as { text?: unknown } | undefined)?.text === "string"
          ? ((parsed.delta as { text: string }).text ?? "")
          : typeof (parsed.content_block as { text?: unknown } | undefined)?.text === "string"
            ? ((parsed.content_block as { text: string }).text ?? "")
            : typeof parsed.text === "string"
              ? parsed.text
              : "";
      if (deltaText) chunks.push(deltaText);
    } catch {
      chunks.push(trimmed);
    }
  }
  return chunks.join("\n");
}

function extractOmcResult(text: string): "succeeded" | "failed" | "blocked" | "unknown" {
  const tail = text.length > MAX_CHARS_FOR_OMC_RESULT_TAIL ? text.slice(-MAX_CHARS_FOR_OMC_RESULT_TAIL) : text;
  const match = tail.match(/OMC_RESULT:\s*(succeeded|failed|blocked)/i);
  if (!match) return "unknown";
  const v = match[1]?.toLowerCase();
  if (v === "succeeded" || v === "failed" || v === "blocked") return v;
  return "unknown";
}

function uniqueArtifacts(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function artifactTypeFromRef(ref: string): string {
  const idx = ref.indexOf("://");
  return idx > 0 ? ref.slice(0, idx) : "unknown";
}
