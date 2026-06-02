import { describe, expect, test } from "bun:test";
import { GIT_SYNC_MIN_LOADING_MS, withMinLoadingDuration } from "./minLoadingDuration";

describe("withMinLoadingDuration", () => {
  test("waits until minimum duration elapses", async () => {
    const startedAt = Date.now();
    await withMinLoadingDuration(async () => undefined, 50);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45);
  });

  test("does not extend when task already exceeds minimum", async () => {
    const startedAt = Date.now();
    await withMinLoadingDuration(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    }, 50);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(75);
    expect(elapsed).toBeLessThan(120);
  });

  test("exports git sync minimum duration", () => {
    expect(GIT_SYNC_MIN_LOADING_MS).toBe(500);
  });
});
