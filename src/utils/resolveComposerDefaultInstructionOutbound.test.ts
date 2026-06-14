import { describe, expect, test } from "bun:test";
import {
  buildPluginSlashCommandPath,
  loadDefaultInstructionResolveContext,
  OMC_PLUGIN_SLASH_NAMESPACE,
  resolveComposerDefaultInstructionOutbound,
} from "./resolveComposerDefaultInstructionOutbound";

describe("resolveComposerDefaultInstructionOutbound", () => {
  test("expands OMC short command when plugin installed", () => {
    expect(
      resolveComposerDefaultInstructionOutbound("/ultrawork", {
        omcInstalled: true,
        pluginCacheSkills: [],
        projectSkills: [],
      }),
    ).toBe("/oh-my-claudecode:ultrawork");
  });

  test("keeps namespaced command unchanged", () => {
    expect(
      resolveComposerDefaultInstructionOutbound("/oh-my-claudecode:ultrawork", {
        omcInstalled: true,
        pluginCacheSkills: [],
        projectSkills: [],
      }),
    ).toBe("/oh-my-claudecode:ultrawork");
  });

  test("resolves from plugin cache skill namespace", () => {
    expect(
      resolveComposerDefaultInstructionOutbound("autopilot", {
        omcInstalled: false,
        pluginCacheSkills: [
          {
            name: "autopilot",
            hasSkillMd: true,
            pluginCacheRelPath: "omc/oh-my-claudecode/4.14.6",
          },
        ],
        projectSkills: [],
      }),
    ).toBe("/oh-my-claudecode:autopilot");
  });

  test("buildPluginSlashCommandPath formats Claude Code command path", () => {
    expect(buildPluginSlashCommandPath(OMC_PLUGIN_SLASH_NAMESPACE, "ultrawork")).toBe(
      "/oh-my-claudecode:ultrawork",
    );
  });

  test("loadDefaultInstructionResolveContext resolves without throwing", async () => {
    const ctx = await loadDefaultInstructionResolveContext(null);
    expect(Array.isArray(ctx.pluginCacheSkills)).toBe(true);
    expect(Array.isArray(ctx.projectSkills)).toBe(true);
    expect(typeof ctx.omcInstalled).toBe("boolean");
  });
});
