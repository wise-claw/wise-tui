import { describe, expect, test } from "bun:test";
import {
  buildScheduledTaskScriptCommand,
  normalizeScheduledTaskScriptFilePath,
  resolveScheduledTaskScriptSource,
  shellSingleQuoteForZsh,
} from "./scheduledTaskScript";

describe("normalizeScheduledTaskScriptFilePath", () => {
  test("accepts relative paths and strips leading slash", () => {
    expect(normalizeScheduledTaskScriptFilePath("scripts/run.sh")).toBe("scripts/run.sh");
    expect(normalizeScheduledTaskScriptFilePath("/scripts/run.sh")).toBe("scripts/run.sh");
    expect(normalizeScheduledTaskScriptFilePath("  scripts/run.sh  ")).toBe("scripts/run.sh");
  });

  test("rejects traversal and absolute forms", () => {
    expect(normalizeScheduledTaskScriptFilePath("../x.sh")).toBeNull();
    expect(normalizeScheduledTaskScriptFilePath("a/../b.sh")).toBeNull();
    expect(normalizeScheduledTaskScriptFilePath("~/x.sh")).toBeNull();
    expect(normalizeScheduledTaskScriptFilePath("C:/x.sh")).toBeNull();
    expect(normalizeScheduledTaskScriptFilePath("")).toBeNull();
    expect(normalizeScheduledTaskScriptFilePath(null)).toBeNull();
  });
});

describe("buildScheduledTaskScriptCommand", () => {
  test("prefers file path over inline content", () => {
    const result = buildScheduledTaskScriptCommand({
      scriptFilePath: "bin/job.sh",
      contentMarkdown: "echo inline",
    });
    expect(result).toEqual({
      ok: true,
      mode: "file",
      scriptFilePath: "bin/job.sh",
      command: `zsh -- './bin/job.sh'`,
    });
  });

  test("falls back to inline shell", () => {
    expect(buildScheduledTaskScriptCommand({ contentMarkdown: "npm test", scriptFilePath: null })).toEqual({
      ok: true,
      mode: "inline",
      command: "npm test",
    });
  });

  test("reports empty when neither file nor inline", () => {
    expect(buildScheduledTaskScriptCommand({ contentMarkdown: "  ", scriptFilePath: "" })).toEqual({
      ok: false,
      reason: "脚本内容为空",
    });
  });

  test("escapes single quotes in file path", () => {
    expect(shellSingleQuoteForZsh("a'b.sh")).toBe(`'a'\\''b.sh'`);
    const result = buildScheduledTaskScriptCommand({
      scriptFilePath: "dir/a'b.sh",
      contentMarkdown: "",
    });
    expect(result).toEqual({
      ok: true,
      mode: "file",
      scriptFilePath: "dir/a'b.sh",
      command: `zsh -- './dir/a'\\''b.sh'`,
    });
  });
});

describe("resolveScheduledTaskScriptSource", () => {
  test("file when path present", () => {
    expect(resolveScheduledTaskScriptSource({ scriptFilePath: "a.sh", contentMarkdown: "" })).toBe("file");
    expect(resolveScheduledTaskScriptSource({ scriptFilePath: null, contentMarkdown: "echo 1" })).toBe("inline");
  });
});
