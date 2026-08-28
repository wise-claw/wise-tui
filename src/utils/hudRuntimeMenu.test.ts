import { describe, expect, it } from "vitest";
import {
  capHudRuntimeModelOptions,
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
});
