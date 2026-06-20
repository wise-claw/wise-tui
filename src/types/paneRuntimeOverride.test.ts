import { describe, expect, test } from "bun:test";
import {
  companionPaneRuntimeFromPrimary,
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

  test("resolvePaneRuntimePreset treats empty override as unset", () => {
    expect(resolvePaneRuntimePreset({}, "claude")).toBeNull();
    expect(resolvePaneRuntimePreset(null, "claude")).toBeNull();
  });

  test("companion pane inherits primary runtime override", () => {
    expect(companionPaneRuntimeFromPrimary(null)).toEqual({});
    expect(
      companionPaneRuntimeFromPrimary({
        executionEngine: "claude",
        claudeProxyRoute: "bypass",
      }),
    ).toEqual({
      executionEngine: "claude",
      claudeProxyRoute: "bypass",
    });
  });
});
