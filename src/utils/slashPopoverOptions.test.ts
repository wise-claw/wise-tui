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
      "claude",
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
      "claude",
    );

    expect(options.some((row) => row.label === "autofix-pr")).toBe(true);
  });

  test("codex-rpc keeps extras but hides Claude plugin templates and colliding labels", () => {
    const detected = new Set<string>();
    const extras = {
      detected: [{ type: "command" as const, group: "plugin-cmd" as const, label: "demo-skill", description: "demo" }],
      installed: [{ type: "command" as const, group: "plugin" as const, label: "plugin install demo", description: "install" }],
      skills: [
        { type: "command" as const, group: "skill" as const, label: "my-skill", description: "skill" },
        { type: "command" as const, group: "skill" as const, label: "review", description: "collides with codex builtin" },
      ],
    };

    const empty = getFilteredSlashOptions(
      "",
      extras.detected,
      extras.installed,
      [],
      extras.skills,
      false,
      detected,
      "codex-rpc",
    );
    expect(empty.options.some((row) => row.group === "codex" && row.label === "review")).toBe(true);
    expect(empty.options.some((row) => row.group === "plugin-cmd" && row.label === "demo-skill")).toBe(true);
    // Claude 插件管理模板不混入 Codex
    expect(empty.options.some((row) => row.group === "plugin")).toBe(false);

    const typed = getFilteredSlashOptions(
      "skill",
      extras.detected,
      extras.installed,
      [],
      extras.skills,
      false,
      detected,
      "codex-rpc",
    );
    expect(typed.options.some((row) => row.group === "skill" && row.label === "my-skill")).toBe(true);
    // 与 Codex 内置同名的 skill 不展示，避免冲突
    expect(typed.options.some((row) => row.group === "skill" && row.label === "review")).toBe(false);
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
      "claude",
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
    const runtime = buildRuntimeBuiltinCommands(true, detected, "claude");
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
      "claude",
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
