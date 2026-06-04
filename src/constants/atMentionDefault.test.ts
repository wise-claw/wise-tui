import { describe, expect, test } from "bun:test";
import {
  atMentionDefaultTargetFromSlashOption,
  isSlashOptionAtMentionDefault,
} from "./atMentionDefault";

describe("atMentionDefaultTargetFromSlashOption", () => {
  test("maps execution engine option", () => {
    expect(
      atMentionDefaultTargetFromSlashOption({
        type: "execution_engine",
        executionEngine: "codex",
      }),
    ).toEqual({ kind: "execution_engine", engine: "codex" });
  });

  test("maps terminal option", () => {
    expect(
      atMentionDefaultTargetFromSlashOption({ type: "agent", name: "终端02" }),
    ).toEqual({ kind: "terminal", employeeName: "终端02" });
  });

  test("detects current default", () => {
    const target = { kind: "terminal" as const, employeeName: "终端02" };
    expect(
      isSlashOptionAtMentionDefault({ type: "agent", name: "终端02" }, target),
    ).toBe(true);
    expect(
      isSlashOptionAtMentionDefault({ type: "agent", name: "终端01" }, target),
    ).toBe(false);
  });
});
