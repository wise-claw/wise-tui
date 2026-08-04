import { describe, expect, test } from "bun:test";
import {
  listBuiltinSlashCommandsForEngine,
  resolveEngineSlashCatalogGroup,
  rewriteSlashCommandForEngine,
} from "./engineSlashCommands";

describe("engineSlashCommands", () => {
  test("maps codex and codex-rpc to the same catalog group", () => {
    expect(resolveEngineSlashCatalogGroup("codex")).toBe("codex");
    expect(resolveEngineSlashCatalogGroup("codex-rpc")).toBe("codex");
    expect(resolveEngineSlashCatalogGroup("cursor")).toBe("cursor");
    expect(resolveEngineSlashCatalogGroup("opencode")).toBe("opencode");
    expect(resolveEngineSlashCatalogGroup("claude")).toBe("claude");
  });

  test("codex catalog includes review and excludes Claude plugin", () => {
    const labels = listBuiltinSlashCommandsForEngine("codex-rpc").map((c) => c.label);
    expect(labels).toContain("review");
    expect(labels).toContain("model");
    expect(labels).not.toContain("plugin");
    expect(labels).not.toContain("ultracode");
  });

  test("rewrite normalizes cursor summarize/compress to compact", () => {
    expect(rewriteSlashCommandForEngine("/summarize keep tests", "cursor")).toEqual({
      outbound: "/compact keep tests",
    });
    expect(rewriteSlashCommandForEngine("/compress", "cursor")).toEqual({
      outbound: "/compact",
    });
  });

  test("rewrite blocks Claude-only commands on Codex", () => {
    const result = rewriteSlashCommandForEngine("/plugin list", "codex-rpc");
    expect(result.outbound).toBe("/plugin list");
    expect(result.unsupportedMessage).toContain("Claude Code");
    expect(result.unsupportedMessage).toContain("Codex");
  });

  test("rewrite keeps Codex-native review", () => {
    expect(rewriteSlashCommandForEngine("/review", "codex-rpc")).toEqual({
      outbound: "/review",
    });
  });

  test("rewrite maps opencode resume to sessions", () => {
    expect(rewriteSlashCommandForEngine("/resume", "opencode")).toEqual({
      outbound: "/sessions",
    });
  });
});
