import { describe, expect, test } from "bun:test";
import {
  buildComposerPluginInstallSlashCommands,
  buildComposerPluginInstalledSlashCommands,
  COMPOSER_PLUGIN_SLASH_SUBCOMMANDS,
} from "./composerPluginSlashCommands";

describe("composerPluginSlashCommands", () => {
  test("includes local plugin subcommands", () => {
    const labels = COMPOSER_PLUGIN_SLASH_SUBCOMMANDS.map((row) => row.label);
    expect(labels).toContain("plugin install");
    expect(labels).toContain("plugin marketplace add");
    expect(labels).toContain("plugin list");
  });

  test("includes pinned install templates", () => {
    const labels = buildComposerPluginInstallSlashCommands().map((row) => row.label);
    expect(labels.some((label) => label.includes("oh-my-claudecode@omc"))).toBe(true);
    expect(labels.some((label) => label.startsWith("plugin install "))).toBe(true);
  });

  test("builds installed plugin management commands", () => {
    const labels = buildComposerPluginInstalledSlashCommands([
      {
        id: "oh-my-claudecode@omc",
        scope: "user",
        enabled: true,
        version: "1.0.0",
      },
      {
        id: "gsd@gsd-plugin",
        scope: "project",
        enabled: false,
        version: null,
      },
    ]).map((row) => row.label);

    expect(labels).toContain("plugin uninstall oh-my-claudecode@omc");
    expect(labels).toContain("plugin disable oh-my-claudecode@omc");
    expect(labels).toContain("plugin uninstall gsd@gsd-plugin --scope project");
    expect(labels).toContain("plugin enable gsd@gsd-plugin --scope project");
  });

  test("hides install templates for already installed plugins", () => {
    const labels = buildComposerPluginInstallSlashCommands([
      {
        id: "oh-my-claudecode@omc",
        scope: "user",
        enabled: true,
        version: null,
      },
    ]).map((row) => row.label);

    expect(labels.some((label) => label.includes("oh-my-claudecode@omc"))).toBe(false);
  });
});
