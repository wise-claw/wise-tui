import { describe, expect, test } from "bun:test";
import { stringSetEqual } from "./adaptivePoll";

describe("adaptivePoll", () => {
  test("stringSetEqual compares set membership", () => {
    expect(stringSetEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(stringSetEqual(new Set(["a"]), new Set(["b"]))).toBe(false);
    expect(stringSetEqual(new Set(), new Set())).toBe(true);
  });
});
