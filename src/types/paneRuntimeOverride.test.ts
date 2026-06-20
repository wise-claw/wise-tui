import { describe, expect, test } from "bun:test";
import {
  mergePaneRuntimeOverride,
  paneRuntimePresetToOverride,
  resolvePaneRuntimePreset,
} from "./paneRuntimeOverride";

describe("paneRuntimeOverride", () => {
  test("maps presets to overrides", () => {
    expect(paneRuntimePresetToOverride("claude-direct")).toEqual({
      executionEngine: "claude",
      claudeProxyRoute: "bypass",
    });
    expect(paneRuntimePresetToOverride("claude-proxy")).toEqual({
      executionEngine: "claude",
      claudeProxyRoute: "auto",
    });
    expect(paneRuntimePresetToOverride("codex")).toEqual({
      executionEngine: "codex",
    });
  });

  test("resolves active preset from override", () => {
    expect(
      resolvePaneRuntimePreset(
        { executionEngine: "claude", claudeProxyRoute: "bypass" },
        "claude",
      ),
    ).toBe("claude-direct");
    expect(
      resolvePaneRuntimePreset({ executionEngine: "codex" }, "claude"),
    ).toBe("codex");
  });

  test("merge clears proxy route for non-claude engines", () => {
    expect(
      mergePaneRuntimeOverride(
        { executionEngine: "claude", claudeProxyRoute: "auto" },
        { executionEngine: "codex" },
      ),
    ).toEqual({ executionEngine: "codex" });
  });
});
