import { describe, expect, test } from "bun:test";
import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "./claudeCodeSlashCommands";

describe("claudeCodeSlashCommands", () => {
  test("includes /goal and keeps unique labels", () => {
    const labels = CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.label);
    expect(labels).toContain("goal");
    expect(labels).toContain("workflows");
    expect(labels).toContain("deep-research");
    expect(labels).toContain("fork");
    expect(labels).toContain("code-review");
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("labels stay lowercase slash tokens", () => {
    for (const cmd of CLAUDE_BUILTIN_SLASH_COMMANDS) {
      expect(cmd.label).toMatch(/^[a-z0-9][-a-z0-9]*$/);
      expect(cmd.description.trim().length).toBeGreaterThan(0);
    }
  });
});
