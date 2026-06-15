import { describe, expect, test } from "bun:test";
import type { ClaudeProjectSkill } from "../types";
import { mergeClaudeSkillsForPanel } from "./omcPluginDetect";

function skill(
  name: string,
  overrides: Partial<ClaudeProjectSkill> = {},
): ClaudeProjectSkill {
  return {
    name,
    hasSkillMd: true,
    description: null,
    ...overrides,
  };
}

describe("mergeClaudeSkillsForPanel", () => {
  test("keeps OMC plugin skills and drops duplicate user copies with the same name", () => {
    const merged = mergeClaudeSkillsForPanel(
      [],
      [
        skill("ai-slop-cleaner", { skillScope: "user", isSymlink: true }),
        skill("omc-reference", { skillScope: "user" }),
      ],
      [
        skill("ai-slop-cleaner", {
          pluginCacheRelPath: "omc/oh-my-claudecode/4.14.6/skills/ai-slop-cleaner",
          skillScope: "plugin",
        }),
      ],
    );
    expect(merged.map((row) => row.name)).toEqual(["ai-slop-cleaner", "omc-reference"]);
    expect(merged[0]?.skillScope).toBe("plugin");
    expect(merged[1]?.skillScope).toBe("user");
  });

  test("prefers project scope over plugin and user for the same name", () => {
    const merged = mergeClaudeSkillsForPanel(
      [skill("shared", { skillScope: "project" })],
      [skill("shared", { skillScope: "user" })],
      [skill("shared", { skillScope: "plugin", pluginCacheRelPath: "other/pkg/shared" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.skillScope).toBe("project");
  });
});
