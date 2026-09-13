import { describe, expect, test } from "bun:test";
import {
  isLikelyDeepseekResumeId,
  resolveDeepseekResumeSessionId,
  sessionHasPriorDeepseekTurn,
} from "./deepseekSessionId";
import type { ClaudeSession } from "../types";

function sessionWith(
  content: string,
  claudeSessionId: string | null = null,
): Pick<ClaudeSession, "claudeSessionId" | "messages"> {
  return {
    claudeSessionId,
    messages: [
      {
        id: "m1",
        role: "system",
        content,
        timestamp: 1,
        parts: [{ type: "text", text: content }],
      },
    ] as ClaudeSession["messages"],
  };
}

describe("deepseekSessionId", () => {
  test("accepts opaque dsh session ids and rejects blanks", () => {
    expect(isLikelyDeepseekResumeId("dsh-7f3a91")).toBe(true);
    expect(isLikelyDeepseekResumeId("sess_01H")).toBe(true);
    expect(isLikelyDeepseekResumeId("")).toBe(false);
    expect(isLikelyDeepseekResumeId(null)).toBe(false);
    expect(isLikelyDeepseekResumeId("has space")).toBe(false);
  });

  test("only resolves a resume id after a prior deepseek turn", () => {
    const withTurn = sessionWith("DeepSeek Harness 执行中（新会话，模型：默认）…", "dsh-1");
    expect(sessionHasPriorDeepseekTurn(withTurn.messages)).toBe(true);
    expect(resolveDeepseekResumeSessionId(withTurn, "tab-1")).toBe("dsh-1");

    const withoutTurn = sessionWith("Claude 执行中", "dsh-1");
    expect(sessionHasPriorDeepseekTurn(withoutTurn.messages)).toBe(false);
    expect(resolveDeepseekResumeSessionId(withoutTurn, "tab-1")).toBeNull();
  });

  test("falls back to the session id map", () => {
    const session = sessionWith("DeepSeek Harness 执行完成", null);
    const map = new Map([["tab-1", "dsh-2"]]);
    expect(resolveDeepseekResumeSessionId(session, "tab-1", map)).toBe("dsh-2");
  });
});
