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
    expect(labels).toContain("usage");
    expect(labels).toContain("delete");
    expect(labels).toContain("import");
    expect(labels).toContain("archive");
    expect(labels).toContain("use");
    expect(labels).toContain("sandbox");
    expect(labels).toContain("side");
    expect(labels).toContain("reset");
    expect(labels).toContain("resume");
    expect(labels).not.toContain("plugin");
    expect(labels).not.toContain("ultracode");
  });

  test("codex catalog sorted by label", () => {
    const labels = listBuiltinSlashCommandsForEngine("codex-rpc").map((c) => c.label);
    const sorted = [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(labels).toEqual(sorted);
  });

  test("opencode catalog covers official CLI built-in commands", () => {
    const labels = listBuiltinSlashCommandsForEngine("opencode").map((c) => c.label);
    for (const label of [
      "clear",
      "compact",
      "connect",
      "details",
      "editor",
      "exit",
      "export",
      "help",
      "init",
      "models",
      "new",
      "quit",
      "redo",
      "sessions",
      "share",
      "summarize",
      "themes",
      "thinking",
      "undo",
      "unshare",
    ]) {
      expect(labels).toContain(label);
    }
  });

  test("opencode catalog sorted by label", () => {
    const labels = listBuiltinSlashCommandsForEngine("opencode").map((c) => c.label);
    const sorted = [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(labels).toEqual(sorted);
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

  test("rewrite normalizes codex aliases to canonical commands", () => {
    expect(rewriteSlashCommandForEngine("/r", "codex-rpc")).toEqual({ outbound: "/review" });
    expect(rewriteSlashCommandForEngine("/c keep tests", "codex-rpc")).toEqual({
      outbound: "/clear keep tests",
    });
    expect(rewriteSlashCommandForEngine("/h", "codex-rpc")).toEqual({ outbound: "/help" });
    expect(rewriteSlashCommandForEngine("/s", "codex-rpc")).toEqual({ outbound: "/status" });
    expect(rewriteSlashCommandForEngine("/approvals", "codex-rpc")).toEqual({
      outbound: "/permissions",
    });
    expect(rewriteSlashCommandForEngine("/models", "codex-rpc")).toEqual({
      outbound: "/model",
    });
  });

  test("rewrite keeps native codex reset/exit instead of aliasing", () => {
    expect(rewriteSlashCommandForEngine("/reset", "codex-rpc")).toEqual({
      outbound: "/reset",
    });
    expect(rewriteSlashCommandForEngine("/exit", "codex-rpc")).toEqual({
      outbound: "/exit",
    });
  });

  test("rewrite maps opencode resume to sessions", () => {
    expect(rewriteSlashCommandForEngine("/resume", "opencode")).toEqual({
      outbound: "/sessions",
    });
    expect(rewriteSlashCommandForEngine("/continue", "opencode")).toEqual({
      outbound: "/sessions",
    });
  });

  test("rewrite keeps opencode exit alias and official commands", () => {
    expect(rewriteSlashCommandForEngine("/quit", "opencode")).toEqual({
      outbound: "/quit",
    });
    expect(rewriteSlashCommandForEngine("/redo", "opencode")).toEqual({
      outbound: "/redo",
    });
    expect(rewriteSlashCommandForEngine("/connect", "opencode")).toEqual({
      outbound: "/connect",
    });
  });
});
