import { describe, expect, test } from "bun:test";
import {
  buildDefaultInstructionSelectOptionGroups,
  slashCommandLabelToDefaultInstructionValue,
} from "./defaultInstructionSelectOptions";

describe("defaultInstructionSelectOptions", () => {
  test("slashCommandLabelToDefaultInstructionValue normalizes slash prefix", () => {
    expect(slashCommandLabelToDefaultInstructionValue("autopilot")).toBe("/autopilot");
    expect(slashCommandLabelToDefaultInstructionValue("/compact")).toBe("/compact");
  });

  test("buildDefaultInstructionSelectOptionGroups includes OMC autopilot when installed", () => {
    const groups = buildDefaultInstructionSelectOptionGroups({
      omcInstalled: true,
      detectedPluginCommands: [],
      installedPluginCommands: [],
      installPluginCommands: [],
      projectSkills: [],
      userSkills: [],
      pluginCacheSkills: [],
    });
    const flat = groups.flatMap((group) => group.options.map((option) => option.value));
    expect(flat).toContain("/oh-my-claudecode:autopilot");
    expect(flat).toContain("/compact");
  });
});
