import { describe, expect, test } from "bun:test";
import {
  isLikelyQoderResumeId,
  resolveQoderResumeSessionId,
} from "./qoderSessionId";

describe("qoderSessionId", () => {
  test("detects Qoder session ids", () => {
    expect(isLikelyQoderResumeId("abcd1234-c09a-40a9-82a7-a565413fa393")).toBe(true);
    expect(isLikelyQoderResumeId("short")).toBe(false);
  });

  test("resolves resume id after prior Qoder turn", () => {
    const session = {
      claudeSessionId: "abcd1234-c09a-40a9-82a7-a565413fa393",
      messages: [
        { role: "system" as const, content: "Qoder CLI 执行中（新会话，模型：默认）…" },
        { role: "assistant" as const, content: "ok" },
      ],
    };
    expect(resolveQoderResumeSessionId(session, "tab-1")).toBe(
      "abcd1234-c09a-40a9-82a7-a565413fa393",
    );
  });

  test("skips resume on first turn", () => {
    expect(
      resolveQoderResumeSessionId(
        { claudeSessionId: "abcd1234-c09a-40a9-82a7-a565413fa393", messages: [] },
        "tab-1",
      ),
    ).toBeNull();
  });
});
