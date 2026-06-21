import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { sessionContextRefreshFingerprint } from "./sessionContextRefreshFingerprint";

function stubSession(contentLength: number): ClaudeSession {
  return {
    id: "s1",
    status: "running",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "x".repeat(contentLength),
        timestamp: 1,
      },
    ],
    repositoryPath: "/repo",
    repositoryName: "wise",
    model: "sonnet",
    createdAt: 1000,
    pendingPrompt: "",
  };
}

describe("sessionContextRefreshFingerprint", () => {
  test("ignores small streaming growth within bucket", () => {
    const short = stubSession(100);
    const longer = stubSession(150);
    expect(sessionContextRefreshFingerprint(short)).toBe(sessionContextRefreshFingerprint(longer));
  });

  test("uses coarser bucket when congested", () => {
    const a = stubSession(100);
    const b = stubSession(500);
    expect(sessionContextRefreshFingerprint(a, { congested: false })).not.toBe(
      sessionContextRefreshFingerprint(b, { congested: false }),
    );
    expect(sessionContextRefreshFingerprint(a, { congested: true })).toBe(
      sessionContextRefreshFingerprint(b, { congested: true }),
    );
  });
});
