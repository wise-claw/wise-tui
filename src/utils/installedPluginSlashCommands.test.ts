import { describe, expect, test } from "bun:test";
import type { ClaudeProjectSkill } from "../types";
import {
  buildInstalledPluginSlashOptionsFromSkills,
  isInvocablePluginSlashSkill,
  pluginInstallRefFromCacheRel,
} from "./installedPluginSlashCommands";

const skill = (overrides: Partial<ClaudeProjectSkill>): ClaudeProjectSkill => ({
  name: "setup",
  hasSkillMd: true,
  description: "OMC setup routing",
  pluginCacheRelPath: "omc/oh-my-claudecode/4.14.6",
  ...overrides,
});

describe("installedPluginSlashCommands", () => {
  test("parses plugin install ref from cache rel path", () => {
    expect(pluginInstallRefFromCacheRel("omc/oh-my-claudecode/4.14.6")).toBe(
      "oh-my-claudecode@omc",
    );
  });

  test("accepts plugin command markdown entries", () => {
    expect(
      isInvocablePluginSlashSkill(
        skill({ entryKind: "command", hasSkillMd: false, fileCount: 1 }),
      ),
    ).toBe(true);
  });

  test("builds slash options and dedupes reserved labels", () => {
    const options = buildInstalledPluginSlashOptionsFromSkills(
      [skill({}), skill({ name: "autopilot", description: "Auto loop" })],
      new Set(["setup"]),
    );
    expect(options.map((row) => row.label)).toEqual(["autopilot"]);
    expect(options[0]?.description).toBe("Auto loop");
  });

  test("includes colon namespaced plugin commands", () => {
    const options = buildInstalledPluginSlashOptionsFromSkills(
      [skill({ name: "loom:init", description: "Loom init", entryKind: "command" })],
      new Set(),
    );
    expect(options.map((row) => row.label)).toEqual(["loom:init"]);
  });
});
