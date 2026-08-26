import { describe, expect, test } from "bun:test";
import { fromComposerModelMenuKey, toComposerModelMenuKey } from "./composerModelMenuKey";

describe("composerModelMenuKey", () => {
  test("round-trips model ids that contain dots", () => {
    expect(fromComposerModelMenuKey(toComposerModelMenuKey("grok-4.6"))).toBe("grok-4.6");
    expect(fromComposerModelMenuKey(toComposerModelMenuKey("grok-4.6-fast"))).toBe("grok-4.6-fast");
    expect(fromComposerModelMenuKey(toComposerModelMenuKey("composer-2.5"))).toBe("composer-2.5");
    expect(toComposerModelMenuKey("grok-4.6")).not.toContain(".");
  });

  test("ignores empty and placeholder keys", () => {
    expect(fromComposerModelMenuKey("")).toBeNull();
    expect(fromComposerModelMenuKey("__no_match__")).toBeNull();
    expect(fromComposerModelMenuKey("auto")).toBe("auto");
  });
});
