import { describe, expect, it } from "vitest";
import {
  capHudRuntimeModelOptions,
  ensureHudCurrentModelOption,
  filterHudPickerItems,
  hudContextPickerFilterPlaceholder,
  hudModelMenuKey,
  hudRuntimeBusyBlocksEngineSwitch,
  parseHudModelMenuKey,
} from "./hudRuntimeMenu";

describe("hudRuntimeMenu", () => {
  it("round-trips model menu keys", () => {
    expect(parseHudModelMenuKey(hudModelMenuKey("gpt-5.4"))).toBe("gpt-5.4");
    expect(parseHudModelMenuKey("claude")).toBeNull();
    expect(parseHudModelMenuKey("hud-model:")).toBeNull();
  });

  it("keeps the current model without truncating the rest", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "latest", label: "Latest" },
    ];
    expect(ensureHudCurrentModelOption(options, "c").map((item) => item.value)).toEqual([
      "c",
      "a",
      "b",
      "latest",
    ]);
  });

  it("keeps the current model when capping", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ];
    expect(capHudRuntimeModelOptions(options, "c", 2).map((item) => item.value)).toEqual([
      "c",
      "a",
    ]);
  });

  it("blocks engine switch only while busy", () => {
    expect(hudRuntimeBusyBlocksEngineSwitch("claude", "codex-rpc", true)).toBe(true);
    expect(hudRuntimeBusyBlocksEngineSwitch("claude", "claude", true)).toBe(false);
    expect(hudRuntimeBusyBlocksEngineSwitch("claude", "codex-rpc", false)).toBe(false);
  });

  it("filters picker items by case-insensitive label", () => {
    const items = [
      { value: "a", label: "wise-tui" },
      { value: "b", label: "fund-awards" },
    ];
    expect(filterHudPickerItems(items, "WISE").map((item) => item.value)).toEqual(["a"]);
    expect(filterHudPickerItems(items, "  ").map((item) => item.value)).toEqual(["a", "b"]);
  });

  it("uses repo-first filter placeholders", () => {
    expect(hudContextPickerFilterPlaceholder("repo")).toBe("过滤仓库...");
    expect(hudContextPickerFilterPlaceholder("engine")).toBe("过滤执行环境...");
    expect(hudContextPickerFilterPlaceholder("model")).toBe("过滤模型...");
  });
});
