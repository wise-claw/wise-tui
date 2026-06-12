import { describe, expect, test } from "bun:test";

describe("monacoSelectionToolbarPosition", () => {
  test("module exports resolve helper", async () => {
    const mod = await import("./monacoSelectionToolbarPosition");
    expect(typeof mod.resolveMonacoSelectionToolbarPosition).toBe("function");
  });
});
