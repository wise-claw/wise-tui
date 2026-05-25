import { describe, expect, test } from "bun:test";
import type { ClaudeInvocationResult } from "../claude";
import { TrellisWorkflowAdapter } from "./trellisAdapter";

function successInvocation(): ClaudeInvocationResult {
  return { success: true, outputLines: [], errorLines: [] };
}

function failedInvocation(): ClaudeInvocationResult {
  return { success: false, outputLines: [], errorLines: ["mock failure"] };
}

function fakeWorktree() {
  return async () => ({ worktreePath: "/tmp/wt", branchName: "wise/trellis/test" });
}

describe("TrellisWorkflowAdapter", () => {
  test("trellis-implement subagent produces trellis:// artifact and Active task prompt", async () => {
    let capturedPrompt = "";
    let capturedRepoPath = "";
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: fakeWorktree(),
      invokeClaude: async (params) => {
        capturedPrompt = params.prompt;
        capturedRepoPath = params.repositoryPath;
        return successInvocation();
      },
    });

    const result = await adapter.execute({
      workflowRunId: "wf-1",
      repositoryPath: "/repo/a",
      sessionId: "session-1",
      taskId: "task-implement-1",
      templateId: "trellis",
      subagentType: "trellis-implement",
      attempt: 1,
    });

    expect(result.status).toBe("succeeded");
    expect(result.artifactRefs).toContain("trellis://task/task-implement-1/implement/attempt-1");
    expect(result.artifactRefs).toContain("repo:///repo/a");
    expect(result.progressSignals?.[0]?.stage).toBe("trellis.implement.dispatched");
    expect(capturedPrompt.startsWith("Active task: task-implement-1")).toBe(true);
    expect(capturedRepoPath).toBe("/tmp/wt");
  });

  test("uses activeTaskPath metadata for the Active task prompt while preserving workflow task id", async () => {
    let capturedPrompt = "";
    let capturedWorktreeTaskId = "";
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: async (_repoPath, taskId) => {
        capturedWorktreeTaskId = taskId;
        return { worktreePath: "/tmp/wt", branchName: "wise/trellis/test" };
      },
      invokeClaude: async (params) => {
        capturedPrompt = params.prompt;
        return successInvocation();
      },
    });

    const result = await adapter.execute({
      workflowRunId: "wf-active-path",
      repositoryPath: "/repo/a",
      sessionId: "session-active-path",
      taskId: "task-1",
      templateId: "trellis",
      subagentType: "trellis-implement",
      executionMetadata: {
        activeTaskPath: ".trellis/tasks/05-19-prd/05-19-child",
        sourceRequirementIds: ["REQ-1"],
        prdAnchor: {
          from: 12,
          to: 48,
          textHash: "req-1-body-hash",
          contextBefore: "Before",
          contextAfter: "After",
        },
      },
      attempt: 7,
    });

    expect(result.status).toBe("succeeded");
    expect(capturedPrompt.startsWith("Active task: .trellis/tasks/05-19-prd/05-19-child")).toBe(true);
    expect(capturedWorktreeTaskId).toBe("task-1");
    expect(result.artifactRefs).toContain("trellis://task/task-1/implement/attempt-7");
    expect(result.progressSignals?.[0]?.metadata).toMatchObject({
      sourceRequirementIds: ["REQ-1"],
      prdAnchor: {
        from: 12,
        to: 48,
        textHash: "req-1-body-hash",
      },
    });
  });


  test("trellis-check subagent produces a check-stage artifact", async () => {
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: fakeWorktree(),
      invokeClaude: async () => successInvocation(),
    });

    const result = await adapter.execute({
      workflowRunId: "wf-2",
      repositoryPath: "/repo/b",
      sessionId: "session-2",
      taskId: "task-check-1",
      templateId: "trellis",
      subagentType: "trellis-check",
      attempt: 3,
    });

    expect(result.status).toBe("succeeded");
    expect(result.artifactRefs).toContain("trellis://task/task-check-1/check/attempt-3");
    expect(result.progressSignals?.[0]?.stage).toBe("trellis.check.dispatched");
  });

  test("trellis execution carries repository member attribution", async () => {
    let capturedStreamUi:
      | {
          ownerKind?: string;
          ownerRepositoryId?: number;
          ownerRepositoryName?: string;
          repositoryType?: string;
          stage?: string;
          subagentType?: string;
          taskId?: string;
          sourceRequirementIds?: string[];
          prdAnchor?: {
            from: number;
            to: number;
            textHash: string;
            contextBefore: string;
            contextAfter: string;
          } | null;
        }
      | undefined;
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: fakeWorktree(),
      invokeClaude: async (params) => {
        capturedStreamUi = params.streamUi;
        return successInvocation();
      },
    });

    const result = await adapter.execute({
      workflowRunId: "wf-repo-owner",
      repositoryPath: "/repo/frontend",
      sessionId: "session-owner",
      taskId: "task-owner-1",
      templateId: "trellis",
      subagentType: "trellis-implement",
      executionMetadata: {
        ownerKind: "repository",
        ownerRepositoryId: 42,
        ownerRepositoryName: "frontend app",
        ownerRepositoryPath: "/repo/frontend",
        repositoryType: "frontend",
        sourceRequirementIds: ["REQ-1"],
        prdAnchor: {
          from: 12,
          to: 48,
          textHash: "req-1-body-hash",
          contextBefore: "Before",
          contextAfter: "After",
        },
      },
      attempt: 2,
    });

    expect(result.progressSignals?.[0]?.metadata).toMatchObject({
      ownerKind: "repository",
      ownerRepositoryId: 42,
      ownerRepositoryName: "frontend app",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
      taskId: "task-owner-1",
      sourceRequirementIds: ["REQ-1"],
      prdAnchor: {
        from: 12,
        to: 48,
        textHash: "req-1-body-hash",
      },
    });
    expect(capturedStreamUi).toMatchObject({
      ownerKind: "repository",
      ownerRepositoryId: 42,
      ownerRepositoryName: "frontend app",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
      taskId: "task-owner-1",
      sourceRequirementIds: ["REQ-1"],
      prdAnchor: {
        from: 12,
        to: 48,
        textHash: "req-1-body-hash",
      },
    });
  });

  test("unknown subagentType falls back to /trellis:continue", async () => {
    let capturedPrompt = "";
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: fakeWorktree(),
      invokeClaude: async (params) => {
        capturedPrompt = params.prompt;
        return successInvocation();
      },
    });

    const result = await adapter.execute({
      workflowRunId: "wf-3",
      repositoryPath: "/repo/c",
      sessionId: "session-3",
      taskId: "task-cont-1",
      templateId: "trellis",
      attempt: 1,
    });

    expect(result.status).toBe("succeeded");
    expect(capturedPrompt.startsWith("/trellis:continue")).toBe(true);
    expect(result.artifactRefs).toContain("trellis://task/task-cont-1/continue/attempt-1");
  });

  test("failed Claude invocation produces a trellis-error artifact and retryable error", async () => {
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: fakeWorktree(),
      invokeClaude: async () => failedInvocation(),
    });

    const result = await adapter.execute({
      workflowRunId: "wf-4",
      repositoryPath: "/repo/d",
      sessionId: "session-4",
      taskId: "task-fail-1",
      templateId: "trellis",
      subagentType: "trellis-implement",
      attempt: 2,
    });

    expect(result.status).toBe("failed");
    expect(result.artifactRefs[0]).toBe("trellis-error://task/task-fail-1/implement/attempt-2");
    expect(result.error?.code).toBe("WF_TASK_EXEC_FAILED");
    expect(result.error?.retryable).toBe(true);
  });

  test("worktree failure surfaces as a failed execution with error artifact", async () => {
    const adapter = new TrellisWorkflowAdapter({
      prepareWorktree: async () => {
        throw new Error("worktree boom");
      },
      invokeClaude: async () => successInvocation(),
    });

    const result = await adapter.execute({
      workflowRunId: "wf-5",
      repositoryPath: "/repo/e",
      sessionId: "session-5",
      taskId: "task-wt-1",
      templateId: "trellis",
      subagentType: "trellis-check",
      attempt: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.artifactRefs[0]).toBe("trellis-error://task/task-wt-1/check/attempt-1");
    expect(result.error?.message).toContain("worktree boom");
  });
});
