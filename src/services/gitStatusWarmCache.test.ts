import { describe, expect, test } from "bun:test";
import type { GitStatusResponse } from "../types";
import { createGitStatusWarmCache } from "./gitStatusWarmCache";

function status(marker: number): GitStatusResponse {
  return { marker } as unknown as GitStatusResponse;
}

describe("gitStatusWarmCache", () => {
  test("dedupes a warm path and lets the consumer reuse the same request", async () => {
    let calls = 0;
    const cache = createGitStatusWarmCache(async () => status(++calls));
    cache.prefetch(" /repo ");
    cache.prefetch("/repo");

    const warm = cache.consume("/repo");
    expect(warm).not.toBeNull();
    expect(await warm).toEqual(status(1));
    expect(calls).toBe(1);
    expect(cache.size()).toBe(0);
  });

  test("failed abandoned prefetch cleans itself without retaining a rejected entry", async () => {
    const cache = createGitStatusWarmCache(async () => {
      throw new Error("git unavailable");
    });
    cache.prefetch("/broken");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cache.size()).toBe(0);
    expect(cache.consume("/broken")).toBeNull();
  });

  test("bounds entries and evicts the least recently used path", () => {
    const cache = createGitStatusWarmCache(async (path) => status(path.length), {
      maxEntries: 2,
    });
    cache.prefetch("/a");
    cache.prefetch("/b");
    cache.prefetch("/a");
    cache.prefetch("/c");

    expect(cache.size()).toBe(2);
    expect(cache.consume("/b")).toBeNull();
    expect(cache.consume("/a")).not.toBeNull();
    expect(cache.consume("/c")).not.toBeNull();
  });

  test("expires entries at the TTL boundary", () => {
    let now = 10;
    const cache = createGitStatusWarmCache(async () => status(1), {
      ttlMs: 50,
      now: () => now,
    });
    cache.prefetch("/repo");
    now = 60;

    expect(cache.consume("/repo")).toBeNull();
    expect(cache.size()).toBe(0);
  });
});
