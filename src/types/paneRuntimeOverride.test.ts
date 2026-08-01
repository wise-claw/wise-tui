import { describe, expect, test } from "bun:test";
import {
  companionPaneRuntimeFromPrimary,
  mergePaneRuntimeOverride,
  paneRuntimePresetToOverride,
  resolvePaneExecutionEnvironmentMenuSelection,
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

  test("codex-rpc 不映射到 Codex CLI 预设", () => {
    expect(
      resolvePaneRuntimePreset({ executionEngine: "codex-rpc" }, "claude"),
    ).toBeNull();
  });

  test("菜单选中态：codex-rpc 与 Claude 预设互斥", () => {
    const selection = resolvePaneExecutionEnvironmentMenuSelection({
      override: { executionEngine: "codex-rpc" },
      fallbackEngine: "claude",
      inferredPreset: "claude-direct",
    });
    expect(selection.selectedKeys).toEqual(["codex-rpc"]);
    expect(selection.highlightPreset).toBeNull();
    expect(selection.highlightExtraEngine).toBe("codex-rpc");
  });

  test("菜单选中态：无 override 但 fallback 为 codex-rpc 时只选中额外引擎", () => {
    const selection = resolvePaneExecutionEnvironmentMenuSelection({
      override: null,
      fallbackEngine: "codex-rpc",
      inferredPreset: "claude-direct",
    });
    expect(selection.selectedKeys).toEqual(["codex-rpc"]);
    expect(selection.highlightPreset).toBeNull();
    expect(selection.highlightExtraEngine).toBe("codex-rpc");
  });

  test("菜单选中态：Claude 直连预设仅一项", () => {
    const selection = resolvePaneExecutionEnvironmentMenuSelection({
      override: { executionEngine: "claude", claudeProxyRoute: "bypass" },
      fallbackEngine: "claude",
      inferredPreset: null,
    });
    expect(selection.selectedKeys).toEqual(["claude-direct"]);
    expect(selection.highlightPreset).toBe("claude-direct");
    expect(selection.highlightExtraEngine).toBeNull();
  });
});
