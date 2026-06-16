import { describe, expect, test } from "bun:test";
import {
  shouldShowComposerPluginInstallTemplates,
  slashCommandMatchesQuery,
} from "./slashCommandMatch";

describe("slashCommandMatchesQuery", () => {
  test("matches prefix and substring", () => {
    expect(slashCommandMatchesQuery("plugin install", "plugin")).toBe(true);
    expect(slashCommandMatchesQuery("plugin install", "install")).toBe(true);
    expect(slashCommandMatchesQuery("setup-bedrock", "set")).toBe(true);
  });

  test("matches multi-word progressive query", () => {
    expect(slashCommandMatchesQuery("plugin install", "plugin ins")).toBe(true);
    expect(slashCommandMatchesQuery("plugin marketplace add", "plugin market")).toBe(true);
    expect(slashCommandMatchesQuery("plugin install oh-my-claudecode@omc", "plugin install oh")).toBe(
      true,
    );
  });

  test("matches colon namespaced commands", () => {
    expect(slashCommandMatchesQuery("loom:init", "loom:")).toBe(true);
    expect(slashCommandMatchesQuery("loom:init", "loom:i")).toBe(true);
    expect(slashCommandMatchesQuery("foo:bar:baz", "foo:bar:")).toBe(true);
  });

  test("rejects unrelated queries", () => {
    expect(slashCommandMatchesQuery("plugin install", "setup")).toBe(false);
    expect(slashCommandMatchesQuery("plugin install", "plugin uninstall")).toBe(false);
  });
});

describe("shouldShowComposerPluginInstallTemplates", () => {
  test("shows only when query starts with plugin", () => {
    expect(shouldShowComposerPluginInstallTemplates("plugin")).toBe(true);
    expect(shouldShowComposerPluginInstallTemplates("plugin install")).toBe(true);
    expect(shouldShowComposerPluginInstallTemplates("plu")).toBe(false);
    expect(shouldShowComposerPluginInstallTemplates("")).toBe(false);
  });
});
