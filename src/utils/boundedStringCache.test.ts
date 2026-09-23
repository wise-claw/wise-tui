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

  test("countKeyChars budgets large keys and rejects oversized key+value entries", () => {
    const cache = createBoundedStringCache({
      maxEntries: 10,
      maxChars: 20,
      maxEntryChars: 12,
      countKeyChars: true,
    });
    cache.set("aaaa", "1111");
    cache.set("bbbb", "2222");
    expect(cache.chars).toBe(16);
    cache.set("cccc", "3333");
    expect(cache.get("aaaa")).toBeUndefined();
    expect(cache.chars).toBe(16);
    expect(cache.set("dddddddd", "12345")).toBe(false);
    expect(cache.set("bbbb", "")).toBe(true);
    expect(cache.chars).toBe(12);
  });
});
