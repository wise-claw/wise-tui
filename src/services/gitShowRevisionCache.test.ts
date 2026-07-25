import { describe, expect, test } from "bun:test";
import { createGitShowRevisionCache } from "./gitShowRevisionCache";

describe("createGitShowRevisionCache", () => {
  test("命中未过期条目并做 LRU 提升", () => {
    const cache = createGitShowRevisionCache({ ttlMs: 1000, maxEntries: 2 });
    const t0 = 1_000_000;
    cache.set("/repo", "HEAD:a.ts", "A", t0);
    cache.set("/repo", "HEAD:b.ts", "B", t0);
    expect(cache.get("/repo", "HEAD:a.ts", t0 + 10)).toBe("A");
    // 再写一条应淘汰最久未用的 b（a 刚被 get）
    cache.set("/repo", "HEAD:c.ts", "C", t0 + 20);
    expect(cache.size()).toBe(2);
    expect(cache.get("/repo", "HEAD:b.ts", t0 + 30)).toBeUndefined();
    expect(cache.get("/repo", "HEAD:a.ts", t0 + 30)).toBe("A");
    expect(cache.get("/repo", "HEAD:c.ts", t0 + 30)).toBe("C");
  });

  test("过期后 miss", () => {
    const cache = createGitShowRevisionCache({ ttlMs: 100, maxEntries: 8 });
    const t0 = 5_000;
    cache.set("/repo", "HEAD:a.ts", "A", t0);
    expect(cache.get("/repo", "HEAD:a.ts", t0 + 101)).toBeUndefined();
  });
});
