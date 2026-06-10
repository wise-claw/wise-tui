import { describe, expect, test } from "bun:test";
import type { ClaudeProjectSkill } from "../types";
import {
  isClaudeProjectCommand,
  resolveClaudeProjectSkillDisplayPath,
} from "./claudeProjectSkillPath";

const baseSkill = (overrides: Partial<ClaudeProjectSkill> = {}): ClaudeProjectSkill => ({
  name: "demo",
  hasSkillMd: true,
  description: null,
  ...overrides,
});

describe("resolveClaudeProjectSkillDisplayPath", () => {
  test("prefers skillRootPath when present", () => {
    expect(
      resolveClaudeProjectSkillDisplayPath(
        baseSkill({ skillRootPath: "/tmp/wise/.claude/skills/demo" }),
        "/tmp/wise",
      ),
    ).toBe("/tmp/wise/.claude/skills/demo");
  });

  test("resolves command entries under .claude/commands", () => {
    expect(
      resolveClaudeProjectSkillDisplayPath(
        baseSkill({
          name: "cc-workflow-ai-editor",
          entryKind: "command",
          commandRelPath: "cc-workflow-ai-editor.md",
          hasSkillMd: false,
        }),
        "/Users/sjl/Documents/github/wise",
      ),
    ).toBe("/Users/sjl/Documents/github/wise/.claude/commands/cc-workflow-ai-editor.md");
  });

  test("falls back to project skill directory", () => {
    expect(
      resolveClaudeProjectSkillDisplayPath(baseSkill({ name: "trellis-check" }), "/repo/root"),
    ).toBe("/repo/root/.claude/skills/trellis-check");
  });
});

describe("isClaudeProjectCommand", () => {
  test("detects command entry kind", () => {
    expect(isClaudeProjectCommand(baseSkill({ entryKind: "command" }))).toBe(true);
    expect(isClaudeProjectCommand(baseSkill({ entryKind: "skill" }))).toBe(false);
  });
});
