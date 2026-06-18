import { describe, expect, test } from "bun:test";
import {
  isLikelyOpencodeResumeId,
  resolveOpencodeResumeSessionId,
} from "./opencodeSessionId";

describe("opencodeSessionId", () => {
  test("detects OpenCode session ids", () => {
    expect(isLikelyOpencodeResumeId("ses_abc123XYZ")).toBe(true);
    expect(isLikelyOpencodeResumeId("claude-uuid")).toBe(false);
  });

  test("resolves resume id after prior OpenCode turn", () => {
    const session = {
      claudeSessionId: "ses_resume123",
      messages: [
        { role: "system" as const, content: "OpenCode 执行中（新会话，模型：默认）…" },
        { role: "assistant" as const, content: "ok" },
      ],
    };
    expect(resolveOpencodeResumeSessionId(session, "tab-1")).toBe("ses_resume123");
  });

  test("skips resume on first turn", () => {
    expect(
      resolveOpencodeResumeSessionId(
        { claudeSessionId: "ses_resume123", messages: [] },
        "tab-1",
      ),
    ).toBeNull();
  });
});
