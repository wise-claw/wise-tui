import { describe, expect, test } from "bun:test";
import { normalizeEmployeeBindingName } from "./employeeBindingName";

describe("normalizeEmployeeBindingName", () => {
  test("collapses numeric suffix", () => {
    expect(normalizeEmployeeBindingName("终端01")).toBe("终端1");
    expect(normalizeEmployeeBindingName("终端1")).toBe("终端1");
  });

  test("leaves non-suffixed names unchanged", () => {
    expect(normalizeEmployeeBindingName("Alice")).toBe("Alice");
  });
});
