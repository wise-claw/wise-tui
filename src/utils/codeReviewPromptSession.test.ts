import { describe, expect, it } from "bun:test";
import { buildCodeReviewPrompt } from "../services/codeReview/buildCodeReviewPrompt";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  CODE_REVIEW_PROMPT_SIGNATURE,
  isCodeReviewPromptHistorySession,
} from "./codeReviewPromptSession";

function userMessage(content: string, id = 1): ClaudeMessage {
  return { id, role: "user", content, parts: [{ type: "text", text: content }], timestamp: id };
}

function session(
  partial: Partial<Pick<ClaudeSession, "messages" | "diskPreview">>,
): Pick<ClaudeSession, "messages" | "diskPreview"> {
  return { messages: [], ...partial };
}

describe("isCodeReviewPromptHistorySession", () => {
  it("识别真实 buildCodeReviewPrompt 产出，避免签名与 prompt 文案漂移", () => {
    const prompt = buildCodeReviewPrompt({
      repositoryPath: "/tmp/repo",
      scope: "working",
      baseRef: null,
      headRef: null,
      branch: "main",
      filePaths: ["src/a.ts"],
      diffText: "diff --git a/src/a.ts b/src/a.ts",
      truncated: false,
      empty: false,
    });

    expect(prompt.startsWith(CODE_REVIEW_PROMPT_SIGNATURE)).toBe(true);
    expect(isCodeReviewPromptHistorySession(session({ messages: [userMessage(prompt)] }))).toBe(
      true,
    );
  });

  it("消息被淘汰后仅凭 diskPreview 也能识别", () => {
    expect(
      isCodeReviewPromptHistorySession(
        session({ diskPreview: `${CODE_REVIEW_PROMPT_SIGNATURE}（对标 Cursor Bugbot` }),
      ),
    ).toBe(true);
  });

  it("签名足够短，可存活磁盘 preview 的 80 字符截断", () => {
    expect(CODE_REVIEW_PROMPT_SIGNATURE.length).toBeLessThan(80);
  });

  it("不误伤普通会话与「修复此发现」会话", () => {
    expect(isCodeReviewPromptHistorySession(session({ messages: [userMessage("你好")] }))).toBe(
      false,
    );
    expect(
      isCodeReviewPromptHistorySession(
        session({ messages: [userMessage("请修复以下代码审查发现的问题。只改必要代码")] }),
      ),
    ).toBe(false);
  });

  it("只看首条用户消息，不被后续引用的 prompt 文本带偏", () => {
    expect(
      isCodeReviewPromptHistorySession(
        session({
          messages: [userMessage("帮我看看", 1), userMessage(CODE_REVIEW_PROMPT_SIGNATURE, 2)],
        }),
      ),
    ).toBe(false);
  });
});
