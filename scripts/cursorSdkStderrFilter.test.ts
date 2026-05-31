import { describe, expect, test } from "bun:test";
import {
  isCursorSdkNoiseStdout,
  withBridgeStdoutWrite,
} from "./cursorSdkStderrFilter.ts";

describe("isCursorSdkNoiseStdout", () => {
  test("treats bare integers and non-json as noise", () => {
    expect(isCursorSdkNoiseStdout("16")).toBe(true);
    expect(isCursorSdkNoiseStdout("not json")).toBe(true);
    expect(isCursorSdkNoiseStdout("[1,2]")).toBe(true);
  });

  test("allows bridge stream events", () => {
    expect(
      isCursorSdkNoiseStdout(JSON.stringify({ type: "agent", agentId: "agent-1" })),
    ).toBe(false);
    expect(
      isCursorSdkNoiseStdout(JSON.stringify({ type: "complete", success: true })),
    ).toBe(false);
  });
});

describe("withBridgeStdoutWrite", () => {
  test("tracks nested writes", () => {
    expect(withBridgeStdoutWrite(() => 1)).toBe(1);
  });
});
