import { describe, expect, test } from "bun:test";
import {
  isComposerLocalSlashEligible,
  parseComposerLocalSlashCommand,
  parseComposerPluginSlashCommand,
  resolveComposerPluginInstallRef,
} from "./composerLocalSlashCommand";

describe("parseComposerPluginSlashCommand", () => {
  test("parses list", () => {
    expect(parseComposerPluginSlashCommand("/plugin list")).toEqual({
      action: "list",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin")).toEqual({
      action: "list",
      scope: "user",
    });
  });

  test("parses install aliases and scope", () => {
    expect(parseComposerPluginSlashCommand("/plugin install oh-my-claudecode@omc --scope user")).toEqual({
      action: "install",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin i oh-my-claudecode@omc")).toEqual({
      action: "install",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
  });

  test("parses marketplace add and update", () => {
    expect(parseComposerPluginSlashCommand("/plugin marketplace add Yeachan-Heo/oh-my-claudecode")).toEqual({
      action: "marketplace_add",
      scope: "user",
      marketplaceSource: "Yeachan-Heo/oh-my-claudecode",
    });
    expect(
      parseComposerPluginSlashCommand(
        "/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode",
      ),
    ).toEqual({
      action: "marketplace_add",
      scope: "user",
      marketplaceSource: "https://github.com/Yeachan-Heo/oh-my-claudecode",
    });
    expect(parseComposerPluginSlashCommand("/plugin marketplace update")).toEqual({
      action: "marketplace_update",
      scope: "user",
    });
  });

  test("falls back to generic cli passthrough", () => {
    expect(parseComposerPluginSlashCommand("/plugin marketplace list")).toEqual({
      action: "cli",
      scope: "user",
      cliArgs: ["marketplace", "list"],
    });
    expect(parseComposerPluginSlashCommand("/plugin search foo")).toEqual({
      action: "cli",
      scope: "user",
      cliArgs: ["search", "foo"],
    });
  });

  test("parses uninstall and enable/disable", () => {
    expect(parseComposerPluginSlashCommand("/plugin uninstall oh-my-claudecode@omc")).toEqual({
      action: "uninstall",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin remove oh-my-claudecode@omc")).toEqual({
      action: "uninstall",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin enable oh-my-claudecode@omc")).toEqual({
      action: "enable",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin disable oh-my-claudecode@omc --scope project")).toEqual({
      action: "disable",
      installRef: "oh-my-claudecode@omc",
      scope: "project",
    });
  });
});

describe("parseComposerLocalSlashCommand", () => {
  test("parses plugin via local wrapper", () => {
    expect(parseComposerLocalSlashCommand("/plugin install oh-my-claudecode")?.kind).toBe("plugin");
  });

  test("parses marketplace add as local plugin command", () => {
    const cmd = parseComposerLocalSlashCommand("/plugin marketplace add foo");
    expect(cmd?.kind).toBe("plugin");
    expect(cmd?.plugin?.action).toBe("marketplace_add");
    expect(cmd?.plugin?.marketplaceSource).toBe("foo");
  });

  test("parses compact context and clear", () => {
    expect(parseComposerLocalSlashCommand("/compact keep tests")).toEqual({
      kind: "compact",
      raw: "/compact keep tests",
    });
    expect(parseComposerLocalSlashCommand("/context")?.kind).toBe("context");
    expect(parseComposerLocalSlashCommand("/context all")).toEqual({
      kind: "context",
      raw: "/context all",
      contextDetailed: true,
    });
    expect(parseComposerLocalSlashCommand("/clear")?.kind).toBe("clear");
  });

  test("parses mcp skills hooks agents status", () => {
    expect(parseComposerLocalSlashCommand("/mcp")?.kind).toBe("mcp");
    expect(parseComposerLocalSlashCommand("/skills")?.kind).toBe("skills");
    expect(parseComposerLocalSlashCommand("/hooks list")?.kind).toBe("hooks");
    expect(parseComposerLocalSlashCommand("/agents list")?.kind).toBe("agents");
    expect(parseComposerLocalSlashCommand("/status")?.kind).toBe("status");
  });

  test("redirects unsupported mcp subcommands", () => {
    expect(parseComposerLocalSlashCommand("/mcp add foo")?.kind).toBe("redirect");
  });

  test("redirects known TUI-only commands", () => {
    expect(parseComposerLocalSlashCommand("/agents")?.kind).toBe("agents");
    expect(parseComposerLocalSlashCommand("/agents running")?.kind).toBe("redirect");
    expect(parseComposerLocalSlashCommand("/permissions")?.kind).toBe("redirect");
    expect(parseComposerLocalSlashCommand("/resume")?.kind).toBe("redirect");
  });

  test("returns null for inline or unknown commands", () => {
    expect(parseComposerLocalSlashCommand("请执行 /plugin install x")).toBeNull();
    expect(parseComposerLocalSlashCommand("/unknown-cmd")).toBeNull();
  });
});

describe("isComposerLocalSlashEligible", () => {
  test("requires plain text only", () => {
    expect(
      isComposerLocalSlashEligible({
        text: "/help",
        imageCount: 0,
        contextCount: 0,
        codeSelectionRefCount: 0,
      }),
    ).toBe(true);
    expect(
      isComposerLocalSlashEligible({
        text: "/help",
        imageCount: 1,
      }),
    ).toBe(false);
  });
});

describe("resolveComposerPluginInstallRef", () => {
  test("resolves catalog shorthand", () => {
    expect(resolveComposerPluginInstallRef("oh-my-claudecode")).toBe("oh-my-claudecode@omc");
  });

  test("throws for unknown shorthand", () => {
    expect(() => resolveComposerPluginInstallRef("not-a-real-plugin")).toThrow(/未找到插件/);
  });
});
