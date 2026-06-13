import { describe, expect, test } from "bun:test";
import {
  buildRuntimeBuiltinCommands,
  getFilteredSlashOptions,
  SLASH_POPOVER_MAX_OPTIONS,
} from "./slashPopoverOptions";

describe("getFilteredSlashOptions", () => {
  test("empty query limits claude builtins but keeps plugin and omc groups", () => {
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
    expect(options.some((row) => row.group === "omc")).toBe(true);
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

  test("orders groups as omc, claude, plugin-cmd, plugin, skill", () => {
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
    const omcIndex = groups.indexOf("omc");
    const claudeIndex = groups.indexOf("claude");
    const pluginCmdIndex = groups.indexOf("plugin-cmd");
    const pluginIndex = groups.indexOf("plugin");

    expect(omcIndex).toBeGreaterThanOrEqual(0);
    expect(claudeIndex).toBeGreaterThan(omcIndex);
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
    expect(runtime.length).toBeGreaterThan(SLASH_POPOVER_MAX_OPTIONS);
  });
});
