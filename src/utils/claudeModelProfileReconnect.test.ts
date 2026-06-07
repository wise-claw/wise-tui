import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildClaudeModelSwitchReconnectPlan,
  resolveClaudeResumePromptAfterModelSwitch,
} from "./claudeModelProfileReconnect";

function sessionWithMessages(
  messages: ClaudeSession["messages"],
  overrides: Partial<ClaudeSession> = {},
): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "cc-1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages,
    createdAt: 0,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("resolveClaudeResumePromptAfterModelSwitch", () => {
  test("prefers pending turn prompt", () => {
    const session = sessionWithMessages([
      { id: 1, role: "user", content: "older", timestamp: 1 },
      { id: 2, role: "user", content: "latest", timestamp: 2 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: "in-flight",
      }),
    ).toBe("in-flight");
  });

  test("falls back to last renderable user message", () => {
    const session = sessionWithMessages([
      { id: 1, role: "user", content: "older", timestamp: 1 },
      { id: 2, role: "user", content: "latest", timestamp: 2 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: "  ",
      }),
    ).toBe("latest");
  });

  test("returns null when no user prompt exists", () => {
    const session = sessionWithMessages([
      { id: 1, role: "assistant", content: "hi", timestamp: 1 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: null,
      }),
    ).toBeNull();
  });
});

describe("buildClaudeModelSwitchReconnectPlan", () => {
  test("idle + model unchanged + no host process => noop", () => {
    const session = sessionWithMessages([], { model: "glm", status: "idle" });
    const plan = buildClaudeModelSwitchReconnectPlan({
      session,
      effectiveModel: "glm",
      hasStreamingProcess: false,
      hasInflightInvocation: false,
      isTerminalWorker: false,
      isFailoverInProgress: false,
    });
    expect(plan.shouldTeardownHost).toBe(false);
    expect(plan.shouldAutoResume).toBe(false);
    expect(plan.updateModel).toBeNull();
    expect(plan.notifyMessage).toBeNull();
  });

  test("idle + model changed => notify without auto resume", () => {
    const session = sessionWithMessages([], { model: "sonnet", status: "idle" });
    const plan = buildClaudeModelSwitchReconnectPlan({
      session,
      effectiveModel: "glm",
      hasStreamingProcess: false,
      hasInflightInvocation: false,
      isTerminalWorker: false,
      isFailoverInProgress: false,
    });
    expect(plan.shouldTeardownHost).toBe(false);
    expect(plan.shouldAutoResume).toBe(false);
    expect(plan.updateModel).toBe("glm");
    expect(plan.notifyMessage).toContain("下次发送");
  });

  test("running + prompt => auto resume", () => {
    const session = sessionWithMessages(
      [{ id: 1, role: "user", content: "do work", timestamp: 1 }],
      { status: "running" },
    );
    const plan = buildClaudeModelSwitchReconnectPlan({
      session,
      effectiveModel: "glm",
      hasStreamingProcess: true,
      hasInflightInvocation: true,
      isTerminalWorker: false,
      isFailoverInProgress: false,
    });
    expect(plan.shouldTeardownHost).toBe(true);
    expect(plan.shouldAutoResume).toBe(true);
    expect(plan.resumePrompt).toBe("do work");
    expect(plan.notifyMessage).toContain("正在使用新模型");
  });

  test("running without prompt => stop only", () => {
    const session = sessionWithMessages([], { status: "running" });
    const plan = buildClaudeModelSwitchReconnectPlan({
      session,
      effectiveModel: "glm",
      hasStreamingProcess: false,
      hasInflightInvocation: false,
      isTerminalWorker: false,
      isFailoverInProgress: false,
    });
    expect(plan.shouldAutoResume).toBe(false);
    expect(plan.notifyMessage).toContain("请重新发送");
  });

  test("skips auto resume during failover retry", () => {
    const session = sessionWithMessages(
      [{ id: 1, role: "user", content: "do work", timestamp: 1 }],
      { status: "running" },
    );
    const plan = buildClaudeModelSwitchReconnectPlan({
      session,
      effectiveModel: "glm",
      pendingTurnPrompt: "do work",
      hasStreamingProcess: true,
      hasInflightInvocation: true,
      isTerminalWorker: false,
      isFailoverInProgress: true,
    });
    expect(plan.shouldAutoResume).toBe(false);
    expect(plan.shouldTeardownHost).toBe(true);
  });
});
