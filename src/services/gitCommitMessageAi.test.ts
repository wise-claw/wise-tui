import { describe, expect, it, mock } from "bun:test";
import type { GitStatusResponse } from "../types";
import {
  generateGitCommitMessageByAi,
  resolveGitCommitAiEngineChain,
} from "./gitCommitMessageAi";

function makeStatus(partial: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    staged: [],
    unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
    branch: "main",
    additions: 1,
    deletions: 0,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
    ...partial,
  };
}

describe("resolveGitCommitAiEngineChain", () => {
  it("puts the default engine first and the repository engine second", () => {
    expect(
      resolveGitCommitAiEngineChain({
        defaultEngine: "claude",
        repositoryEngine: "codex-rpc",
      }),
    ).toEqual(["claude", "codex-rpc"]);
  });

  it("deduplicates when the repository engine matches the default", () => {
    expect(
      resolveGitCommitAiEngineChain({
        defaultEngine: "cursor",
        repositoryEngine: "cursor",
      }),
    ).toEqual(["cursor"]);
  });

  it("skips engines that cannot oneshot", () => {
    expect(
      resolveGitCommitAiEngineChain({
        defaultEngine: "gemini",
        repositoryEngine: "claude",
      }),
    ).toEqual(["claude"]);
    expect(
      resolveGitCommitAiEngineChain({
        defaultEngine: "gemini",
        repositoryEngine: "gemini",
      }),
    ).toEqual([]);
  });

  it("keeps only the default engine when the repository has no override", () => {
    expect(
      resolveGitCommitAiEngineChain({
        defaultEngine: "opencode",
        repositoryEngine: null,
      }),
    ).toEqual(["opencode"]);
  });
});

describe("generateGitCommitMessageByAi", () => {
  it("retries the repository engine after the default engine fails", async () => {
    const invokeEngine = mock(async (params: { executionEngine?: string }) => {
      if (params.executionEngine === "claude") {
        return { success: false, outputLines: [], errorLines: ["default unavailable"] };
      }
      return {
        success: true,
        outputLines: [JSON.stringify({ type: "result", result: "fix: 仓库引擎生成摘要" })],
        errorLines: [],
      };
    });
    const onEngineRetry = mock(() => undefined);

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      repositoryEngine: "codex-rpc",
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "@@ -1 +1 @@",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
      onEngineRetry,
    });

    expect(result).toEqual({
      message: "fix: 仓库引擎生成摘要",
      aiFailed: false,
      engineUsed: "codex-rpc",
    });
    expect(invokeEngine.mock.calls.map((call) => call[0]?.executionEngine)).toEqual([
      "claude",
      "codex-rpc",
    ]);
    expect(onEngineRetry.mock.calls[0]?.[0]).toEqual({
      from: "claude",
      to: "codex-rpc",
      reason: "default unavailable",
    });
  });

  it("does not call the repository engine when the default engine succeeds", async () => {
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: [JSON.stringify({ type: "result", result: "feat: 默认引擎生成摘要" })],
      errorLines: [],
    }));

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      repositoryEngine: "cursor",
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
    });

    expect(result.aiFailed).toBe(false);
    expect(result.engineUsed).toBe("claude");
    expect(invokeEngine).toHaveBeenCalledTimes(1);
  });

  it("concatenates streamed assistant tokens instead of keeping a truncated prefix", async () => {
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: [
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "feat: 推送支持复" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "用草稿并在失败后弹窗" }] },
        }),
      ],
      errorLines: [],
    }));

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
    });

    expect(result.aiFailed).toBe(false);
    expect(result.message).toBe("feat: 推送支持复用草稿并在失败后弹窗");
  });

  it("prefers the concatenated stream over a truncated result snapshot", async () => {
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: [
        JSON.stringify({ type: "result", result: "feat: 推送支持复" }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "feat: 推送支持复" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "用草稿并在失败后弹窗" }] },
        }),
      ],
      errorLines: [],
    }));

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
    });

    expect(result.message).toBe("feat: 推送支持复用草稿并在失败后弹窗");
  });

  it("parses Codex assistant envelopes and fullwidth-colon summaries", async () => {
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: [
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "feat：优化 Git 面板推送" }],
          },
        }),
      ],
      errorLines: [],
    }));

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
    });

    expect(result).toEqual({
      message: "feat: 优化 Git 面板推送",
      aiFailed: false,
      engineUsed: "claude",
    });
  });

  it("returns the rule fallback after every engine fails", async () => {
    const invokeEngine = mock(async () => {
      throw new Error("Cursor ACP unavailable");
    });

    const result = await generateGitCommitMessageByAi({
      repositoryPath: "/repo",
      status: makeStatus(),
      repositoryEngine: "cursor",
      getDefaultEngine: () => "claude",
      getDiffContext: async () => "",
      getClaudeModel: async () => null,
      invokeEngine: invokeEngine as never,
    });

    expect(result.aiFailed).toBe(true);
    expect(result.engineUsed).toBe("cursor");
    expect(result.failureReason).toBe("Cursor ACP unavailable");
    expect(result.message).toContain("feat:");
    expect(invokeEngine).toHaveBeenCalledTimes(2);
  });
});
