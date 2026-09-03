import { describe, expect, test } from "bun:test";
import { createBoundedStringCache } from "./boundedStringCache";

describe("createBoundedStringCache", () => {
  test("evicts least recently used entries at the count limit", () => {
    const cache = createBoundedStringCache({ maxEntries: 2, maxChars: 100 });
    cache.set("a", "one");
    cache.set("b", "two");
    expect(cache.get("a")).toBe("one");
    cache.set("c", "three");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("one");
    expect(cache.get("c")).toBe("three");
  });

  test("enforces total characters and keeps accounting correct on replacement", () => {
    const cache = createBoundedStringCache({ maxEntries: 5, maxChars: 6 });
    cache.set("a", "1234");
    cache.set("a", "12");
    cache.set("b", "3456");
    expect(cache.size).toBe(2);
    expect(cache.chars).toBe(6);
    cache.set("c", "x");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.chars).toBe(5);
  });

  test("does not retain an oversized value or its replaced predecessor", () => {
    const cache = createBoundedStringCache({
      maxEntries: 5,
      maxChars: 100,
      maxEntryChars: 4,
    });
    cache.set("a", "old");
    expect(cache.set("a", "12345")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.chars).toBe(0);
  });
});
