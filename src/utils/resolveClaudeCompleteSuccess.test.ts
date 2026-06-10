import { describe, expect, test } from "bun:test";
import {
  isExplicitClaudeCompleteFailure,
  resolveClaudeCompleteSuccess,
} from "./resolveClaudeCompleteSuccess";

describe("resolveClaudeCompleteSuccess", () => {
  test("treats explicit success=false as failure", () => {
    expect(resolveClaudeCompleteSuccess({ success: false, sessionId: "s1" })).toBe(false);
    expect(isExplicitClaudeCompleteFailure({ success: false, sessionId: "s1" })).toBe(true);
  });

  test("defaults missing success to true", () => {
    expect(resolveClaudeCompleteSuccess({ sessionId: "s1" })).toBe(true);
    expect(isExplicitClaudeCompleteFailure({ sessionId: "s1" })).toBe(false);
  });
});
