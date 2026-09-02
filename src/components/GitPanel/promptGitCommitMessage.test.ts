import { describe, expect, it } from "bun:test";
import { resolveGitPanelPushCommitMessage, resolvePushMessageAfterAi } from "./promptGitCommitMessage";

describe("resolveGitPanelPushCommitMessage", () => {
  it("skips generation when there is nothing to commit", () => {
    expect(
      resolveGitPanelPushCommitMessage({
        needsCommitMessage: false,
        draftMessage: "feat: leftover",
      }),
    ).toEqual({ kind: "push", message: "", consumeDraft: false });
  });

  it("reuses a filled draft instead of generating", () => {
    expect(
      resolveGitPanelPushCommitMessage({
        needsCommitMessage: true,
        draftMessage: "  修复推送弹窗  ",
      }),
    ).toEqual({
      kind: "push",
      message: "feat: 修复推送弹窗",
      consumeDraft: true,
    });
  });

  it("generates with AI when working tree has changes but no draft", () => {
    expect(
      resolveGitPanelPushCommitMessage({
        needsCommitMessage: true,
        draftMessage: "   ",
      }),
    ).toEqual({ kind: "generate" });
  });
});

describe("resolvePushMessageAfterAi", () => {
  it("pushes the generated message when AI succeeds", () => {
    expect(
      resolvePushMessageAfterAi({
        message: "fix: 生成提交信息",
        aiFailed: false,
      }),
    ).toEqual({ kind: "push", message: "fix: 生成提交信息" });
  });

  it("prompts with the fallback draft when AI fails", () => {
    expect(
      resolvePushMessageAfterAi({
        message: "feat: 更新代码",
        aiFailed: true,
      }),
    ).toEqual({ kind: "prompt", initialValue: "feat: 更新代码" });
  });
});
