import type { OmcWorkflowAdapter, TrellisExecutionMetadata, WorkflowApiError } from "../../types/workflow";
import { executeClaudeCodeAndWait, type ClaudeInvocationResult } from "../claude";
import { gitWorktreeAddOmcBatch } from "../git";

export const TRELLIS_TEMPLATE_ID = "trellis";

type TrellisStageHint = "trellis-implement" | "trellis-check" | "trellis-continue";

interface ResolvedStage {
  hint: TrellisStageHint;
  artifactStage: string;
  prompt: string;
}

interface TrellisInvokeParams {
  repositoryPath: string;
  prompt: string;
  connectionMode?: Parameters<typeof executeClaudeCodeAndWait>[0]["connectionMode"];
  bare?: boolean;
  timeoutMs?: number;
  streamUi?: Parameters<typeof executeClaudeCodeAndWait>[0]["streamUi"];
}

export type TrellisInvokeFn = (params: TrellisInvokeParams) => Promise<ClaudeInvocationResult>;
export type TrellisWorktreeFn = (
  repoPath: string,
  taskId: string,
  attempt: number,
) => Promise<{ worktreePath: string; branchName: string }>;

export interface TrellisAdapterOptions {
  invokeClaude?: TrellisInvokeFn;
  prepareWorktree?: TrellisWorktreeFn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function resolveStage(subagentType: string | undefined, taskId: string): ResolvedStage {
  const hint = subagentType?.trim() ?? "";
  const activeTaskLine = `Active task: ${taskId}`;
  if (hint === "trellis-implement") {
    return {
      hint: "trellis-implement",
      artifactStage: "implement",
      prompt:
        `${activeTaskLine}\n\n` +
        "Implement the active Trellis task. Read prd.md, implement to spec, run focused tests, do not commit or stage.",
    };
  }
  if (hint === "trellis-check") {
    return {
      hint: "trellis-check",
      artifactStage: "check",
      prompt:
        `${activeTaskLine}\n\n` +
        "Run the check phase for the active Trellis task. Verify spec compliance, run bun test and any lint/type-check, fix issues found, do not commit.",
    };
  }
  return {
    hint: "trellis-continue",
    artifactStage: "continue",
    prompt: `/trellis:continue\n\n${activeTaskLine}`,
  };
}

function uniqueArtifacts(items: ReadonlyArray<string>): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function artifactTypeFromRef(ref: string): string {
  const idx = ref.indexOf("://");
  return idx > 0 ? ref.slice(0, idx) : "unknown";
}

function buildError(
  message: string,
  resolved: ResolvedStage,
  input: { templateId: string; subagentType?: string; executionMetadata?: TrellisExecutionMetadata },
  startedAt: number,
): WorkflowApiError {
  return {
    code: "WF_TASK_EXEC_FAILED",
    message: `Trellis execution failed: ${message}`,
    retryable: Date.now() - startedAt < 15_000,
    details: {
      templateId: input.templateId,
      stageHint: resolved.hint,
      ...(input.executionMetadata ?? {}),
      subagentType: input.executionMetadata?.subagentType ?? input.subagentType ?? "trellis-implement",
    },
  };
}

export class TrellisWorkflowAdapter implements OmcWorkflowAdapter {
  private readonly invokeClaude: TrellisInvokeFn;
  private readonly prepareWorktree: TrellisWorktreeFn;
  private readonly timeoutMs: number;

  constructor(options: TrellisAdapterOptions = {}) {
    this.invokeClaude = options.invokeClaude ?? executeClaudeCodeAndWait;
    this.prepareWorktree = options.prepareWorktree ?? gitWorktreeAddOmcBatch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async execute(input: {
    workflowRunId: string;
    repositoryPath: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    executionMetadata?: TrellisExecutionMetadata;
    attempt: number;
  }): ReturnType<OmcWorkflowAdapter["execute"]> {
    const startedAt = Date.now();
    const resolved = resolveStage(input.subagentType, input.taskId);
    const executionMetadata = {
      ...(input.executionMetadata ?? {}),
      stage: input.executionMetadata?.stage ?? resolved.artifactStage,
      subagentType: input.executionMetadata?.subagentType ?? input.subagentType ?? resolved.hint,
      taskId: input.executionMetadata?.taskId ?? input.taskId,
    };
    const baseArtifacts = uniqueArtifacts([
      `trellis://task/${input.taskId}/${resolved.artifactStage}/attempt-${input.attempt}`,
      `repo://${input.repositoryPath}`,
    ]);
    const baseProgress = [
      {
        stage: `trellis.${resolved.artifactStage}.dispatched`,
        message: `dispatch trellis ${resolved.hint}`,
        level: "info" as const,
        metadata: {
          stageHint: resolved.hint,
          templateId: input.templateId,
          ...executionMetadata,
        },
      },
    ];
    const baseRecords = baseArtifacts.map((ref) => ({
      ref,
      artifactType: artifactTypeFromRef(ref),
    }));

    try {
      const wt = await this.prepareWorktree(input.repositoryPath, input.taskId, input.attempt);
      const invocation = await this.invokeClaude({
        repositoryPath: wt.worktreePath,
        prompt: resolved.prompt,
        connectionMode: "oneshot",
        bare: true,
        timeoutMs: this.timeoutMs,
        streamUi: {
          sessionId: input.sessionId,
          repositoryPath: input.repositoryPath,
          templateId: input.templateId,
          attempt: input.attempt,
          omcInvocationSource: "workflow",
          ...executionMetadata,
        },
      });
      if (!invocation.success) {
        const errorMessage = invocation.errorLines.join("\n").trim() || "Trellis invocation failed";
        const errorArtifact = `trellis-error://task/${input.taskId}/${resolved.artifactStage}/attempt-${input.attempt}`;
        return {
          status: "failed" as const,
          artifactRefs: [errorArtifact, ...baseArtifacts],
          progressSignals: baseProgress,
          artifactRecords: [
            { ref: errorArtifact, artifactType: "trellis-error" },
            ...baseRecords,
          ],
          summary: `Trellis ${resolved.hint} failed`,
          error: buildError(errorMessage, resolved, input, startedAt),
        };
      }
      return {
        status: "succeeded" as const,
        artifactRefs: baseArtifacts,
        progressSignals: baseProgress,
        artifactRecords: baseRecords,
        summary: `Trellis ${resolved.hint} executed`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorArtifact = `trellis-error://task/${input.taskId}/${resolved.artifactStage}/attempt-${input.attempt}`;
      return {
        status: "failed" as const,
        artifactRefs: [errorArtifact],
        progressSignals: baseProgress,
        artifactRecords: [{ ref: errorArtifact, artifactType: "trellis-error" }],
        summary: `Trellis ${resolved.hint} failed`,
        error: buildError(message, resolved, input, startedAt),
      };
    }
  }
}
