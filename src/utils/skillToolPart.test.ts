import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../types";
import { isSkillToolPart, skillToolDisplayName } from "./skillToolPart";

describe("isSkillToolPart", () => {
  const base = (overrides: Partial<ToolUsePart>): ToolUsePart => ({
    id: "s1",
    type: "tool_use",
    name: "unknown",
    input: {},
    status: "completed",
    ...overrides,
  });

  test("detects Skill tool by name", () => {
    expect(isSkillToolPart(base({ name: "Skill" }))).toBe(true);
    expect(isSkillToolPart(base({ name: "skill" }))).toBe(true);
  });

  test("detects skill tool by input.skill", () => {
    expect(isSkillToolPart(base({ name: "run", input: { skill: "commit" } }))).toBe(true);
  });

  test("returns false for unrelated tools", () => {
    expect(isSkillToolPart(base({ name: "Bash", input: { command: "ls" } }))).toBe(false);
  });
});

describe("skillToolDisplayName", () => {
  test("prefers input.skill over tool name", () => {
    const part: ToolUsePart = {
      id: "s1",
      type: "tool_use",
      name: "Skill",
      input: { skill: "trellis-before-dev" },
      status: "completed",
    };
    expect(skillToolDisplayName(part)).toBe("trellis-before-dev");
  });
});
