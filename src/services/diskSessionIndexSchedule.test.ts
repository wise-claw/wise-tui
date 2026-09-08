import { describe, expect, test } from "bun:test";
import {
  clearDiskSessionIndexScheduleForTests,
  markDiskSessionIndexListed,
  runSharedDiskSessionIndexRefresh,
  wasDiskSessionIndexListedRecently,
} from "./diskSessionIndexSchedule";

describe("diskSessionIndexSchedule", () => {
  test("cooldown skips a second auto-list of the same repository", () => {
    clearDiskSessionIndexScheduleForTests();
    const now = 1_700_000_000_000;
    expect(wasDiskSessionIndexListedRecently("/work/a", now)).toBe(false);
    markDiskSessionIndexListed("/work/a", now);
    expect(wasDiskSessionIndexListedRecently("/work/a", now + 1_000)).toBe(true);
    expect(wasDiskSessionIndexListedRecently("/work/a", now + 31_000)).toBe(false);
    expect(wasDiskSessionIndexListedRecently("/work/b", now + 1_000)).toBe(false);
  });

  test("shares one in-flight refresh per repository path", async () => {
    clearDiskSessionIndexScheduleForTests();
    let runs = 0;
    const run = () =>
      runSharedDiskSessionIndexRefresh("/work/a", async () => {
        runs += 1;
        await Promise.resolve();
      });
    await Promise.all([run(), run(), run()]);
    expect(runs).toBe(1);
  });
});
