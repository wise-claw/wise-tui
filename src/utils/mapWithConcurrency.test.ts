import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "./mapWithConcurrency";

describe("mapWithConcurrency", () => {
  test("preserves input order while bounding active work", async () => {
    let active = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const resultPromise = mapWithConcurrency([3, 2, 1, 0], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return value * 2;
    });

    await Promise.resolve();
    expect(active).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());

    expect(await resultPromise).toEqual([6, 4, 2, 0]);
    expect(peak).toBe(2);
  });

  test("stops scheduling untouched items after the first failure", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3], 1, async (value) => {
        started.push(value);
        if (value === 1) throw new Error("boom");
        return value;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
  });

  test("normalizes invalid concurrency to one worker", async () => {
    expect(await mapWithConcurrency([1, 2], Number.NaN, (value) => value)).toEqual([1, 2]);
  });
});
