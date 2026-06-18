import { describe, expect, test } from "bun:test";
import {
  buildRuntimeBuiltinCommands,
  buildSkillSlashOptionsFromList,
  getFilteredSlashOptions,
  SLASH_POPOVER_MAX_OPTIONS,
} from "./slashPopoverOptions";

describe("getFilteredSlashOptions", () => {
  test("empty query excludes the omc category entirely", () => {
    const detected = new Set<string>();
    const { options } = getFilteredSlashOptions(
      "",
      [],
      [],
      [],
      [],
      true,
      detected,
    );

    expect(options.length).toBeLessThan(80);
    expect(options.some((row) => (row.group as string) === "omc")).toBe(false);
    expect(options.some((row) => row.group === "claude" && row.label === "help")).toBe(true);
    expect(options.some((row) => row.group === "claude" && row.label === "add-dir")).toBe(true);
    expect(options.some((row) => row.group === "claude" && row.label === "autofix-pr")).toBe(false);
  });

  test("typed query searches full builtin catalog", () => {
    const detected = new Set<string>();
    const { options } = getFilteredSlashOptions(
      "autofix",
      [],
      [],
      [],
      [],
      false,
      detected,
    );

    expect(options.some((row) => row.label === "autofix-pr")).toBe(true);
  });

  test("orders groups as claude, plugin-cmd, plugin", () => {
    const detected = new Set<string>();
    const { options } = getFilteredSlashOptions(
      "",
      [{ type: "command", group: "plugin-cmd", label: "demo-skill", description: "demo" }],
      [{ type: "command", group: "plugin", label: "plugin install demo", description: "install" }],
      [],
      [{ type: "command", group: "skill", label: "should-not-show", description: "skill" }],
      true,
      detected,
    );

    const groups = options.map((row) => row.group);
    const claudeIndex = groups.indexOf("claude");
    const pluginCmdIndex = groups.indexOf("plugin-cmd");
    const pluginIndex = groups.indexOf("plugin");

    expect(groups.some((g) => (g as string) === "omc")).toBe(false);
    expect(claudeIndex).toBeGreaterThanOrEqual(0);
    expect(pluginCmdIndex).toBeGreaterThan(claudeIndex);
    expect(pluginIndex).toBeGreaterThan(pluginCmdIndex);
    expect(groups.includes("skill")).toBe(false);
  });

  test("caps visible slash options", () => {
    const detected = new Set<string>();
    const runtime = buildRuntimeBuiltinCommands(true, detected);
    const manySkills = Array.from({ length: 80 }, (_, index) => ({
      type: "command" as const,
      group: "skill" as const,
      label: `skill-${index}`,
      description: "skill",
    }));

    const { options, truncated } = getFilteredSlashOptions(
      "skill",
      [],
      [],
      [],
      manySkills,
      true,
      detected,
    );

    expect(options.length).toBe(SLASH_POPOVER_MAX_OPTIONS);
    expect(truncated).toBe(true);
    expect(runtime.length).toBeGreaterThan(0);
  });
});

describe("buildSkillSlashOptionsFromList", () => {
  test("includes global user skills and prefers project over user on name clash", () => {
    const options = buildSkillSlashOptionsFromList(
      {
        projectSkills: [{ name: "shared-skill", hasSkillMd: true, description: "项目版" }],
        userSkills: [
          { name: "shared-skill", hasSkillMd: true, description: "全局版" },
          { name: "global-only", hasSkillMd: true, description: "仅全局" },
        ],
      },
      new Set(),
    );

    expect(options.map((row) => row.label).sort()).toEqual(["global-only", "shared-skill"]);
    expect(options.find((row) => row.label === "shared-skill")?.description).toBe("项目版");
    expect(options.find((row) => row.label === "global-only")?.description).toBe("仅全局");
  });
});
