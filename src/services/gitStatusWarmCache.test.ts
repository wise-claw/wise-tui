import { describe, expect, test } from "bun:test";
import type { GitStatusResponse } from "../types";
import { createGitStatusWarmCache } from "./gitStatusWarmCache";

function status(marker: number): GitStatusResponse {
  return { marker } as unknown as GitStatusResponse;
}

describe("gitStatusWarmCache", () => {
  test("dedupes a warm path and lets multiple consumers share the same request", async () => {
    let calls = 0;
    const cache = createGitStatusWarmCache(async () => status(++calls));
    cache.prefetch(" /repo ");
    cache.prefetch("/repo");

    const first = cache.peek("/repo");
    const second = cache.peek("/repo");
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(await first).toEqual(status(1));
    expect(calls).toBe(1);
    expect(cache.size()).toBe(1);
    expect(cache.getResolved("/repo")).toEqual(status(1));
  });

  test("peekInFlight only returns unresolved prefetch promises", async () => {
    const cache = createGitStatusWarmCache(async () => {
      await Promise.resolve();
      return status(4);
    });
    cache.prefetch("/repo");
    expect(cache.peekInFlight("/repo")).not.toBeNull();
    await cache.peek("/repo");
    expect(cache.peekInFlight("/repo")).toBeNull();
    expect(cache.getResolved("/repo")).toEqual(status(4));
  });

  test("failed abandoned prefetch cleans itself without retaining a rejected entry", async () => {
    const cache = createGitStatusWarmCache(async () => {
      throw new Error("git unavailable");
    });
    cache.prefetch("/broken");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cache.size()).toBe(0);
    expect(cache.peek("/broken")).toBeNull();
    expect(cache.getResolved("/broken")).toBeNull();
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
    expect(cache.peek("/b")).toBeNull();
    expect(cache.peek("/a")).not.toBeNull();
    expect(cache.peek("/c")).not.toBeNull();
  });

  test("expires entries at the TTL boundary", () => {
    let now = 10;
    const cache = createGitStatusWarmCache(async () => status(1), {
      ttlMs: 50,
      now: () => now,
    });
    cache.prefetch("/repo");
    now = 60;

    expect(cache.peek("/repo")).toBeNull();
    expect(cache.size()).toBe(0);
  });

  test("remember stores a resolved snapshot for synchronous switch-back", () => {
    const cache = createGitStatusWarmCache(async () => status(9));
    cache.remember("/repo", status(3));
    expect(cache.getResolved("/repo")).toEqual(status(3));
    expect(cache.peek("/repo")).not.toBeNull();
  });
});
