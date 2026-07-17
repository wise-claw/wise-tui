import { describe, expect, test } from "bun:test";
import {
  QODER_DEFAULT_MODEL,
  buildQoderModelPickerOptions,
  formatQoderModelLabel,
  isQoderModelId,
  resolveQoderExecModelId,
} from "./qoderModel";

describe("qoderModel", () => {
  test("default and tier ids are valid", () => {
    expect(QODER_DEFAULT_MODEL).toBe("auto");
    expect(isQoderModelId("auto")).toBe(true);
    expect(isQoderModelId("efficient")).toBe(true);
    expect(isQoderModelId("sonnet")).toBe(false);
    expect(isQoderModelId("claude-opus-4")).toBe(false);
  });

  test("build picker seeds builtin tiers then CLI extras", () => {
    const opts = buildQoderModelPickerOptions([
      { id: "auto", displayName: "Auto" },
      { id: "Qwen3.7-Max", displayName: "Qwen3.7-Max" },
    ]);
    expect(opts[0]?.value).toBe("auto");
    expect(opts.some((o) => o.value === "efficient")).toBe(true);
    expect(opts.some((o) => o.value === "Qwen3.7-Max")).toBe(true);
    expect(opts.filter((o) => o.value === "auto")).toHaveLength(1);
  });

  test("format and exec model", () => {
    expect(formatQoderModelLabel("auto")).toContain("智能路由");
    expect(formatQoderModelLabel("efficient")).toBe("Efficient");
    expect(resolveQoderExecModelId("auto")).toBeUndefined();
    expect(resolveQoderExecModelId("performance")).toBe("performance");
  });
});
