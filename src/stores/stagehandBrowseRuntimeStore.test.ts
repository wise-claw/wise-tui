import { afterEach, describe, expect, test } from "bun:test";
import {
  appendStagehandBrowseLog,
  getStagehandBrowseRuntimeSnapshot,
  resetStagehandBrowseRuntimeForTests,
  setStagehandBrowsePage,
  setStagehandBrowseScreenshot,
  subscribeStagehandBrowseRuntime,
} from "./stagehandBrowseRuntimeStore";

afterEach(resetStagehandBrowseRuntimeForTests);

describe("stagehandBrowseRuntimeStore", () => {
  test("publishes a new snapshot identity so useSyncExternalStore can observe updates", () => {
    const before = getStagehandBrowseRuntimeSnapshot("global");
    let notifications = 0;
    const unsubscribe = subscribeStagehandBrowseRuntime("global", () => {
      notifications += 1;
    });

    setStagehandBrowseScreenshot("global", "/tmp/page.png");
    const after = getStagehandBrowseRuntimeSnapshot("global");

    expect(after).not.toBe(before);
    expect(after.screenshotPath).toBe("/tmp/page.png");
    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("does not notify for an unchanged scalar value", () => {
    setStagehandBrowseScreenshot("global", "/tmp/page.png");
    let notifications = 0;
    const unsubscribe = subscribeStagehandBrowseRuntime("global", () => {
      notifications += 1;
    });

    setStagehandBrowseScreenshot("global", "/tmp/page.png");
    expect(notifications).toBe(0);
    unsubscribe();
  });

  test("isolates a throwing subscriber and still notifies later subscribers", () => {
    const unsubscribeBad = subscribeStagehandBrowseRuntime("global", () => {
      throw new Error("subscriber failed");
    });
    let called = 0;
    const unsubscribeGood = subscribeStagehandBrowseRuntime("global", () => {
      called += 1;
    });

    appendStagehandBrowseLog("global", "info", "ready");
    expect(called).toBe(1);
    expect(getStagehandBrowseRuntimeSnapshot("global").logs).toHaveLength(1);
    unsubscribeBad();
    unsubscribeGood();
  });

  test("derives running status immutably from daemon page state", () => {
    setStagehandBrowsePage("global", {
      running: true,
      url: "https://example.com",
      title: "Example",
      pageCount: 2,
      authSummary: null,
      cookieCount: 3,
    });

    expect(getStagehandBrowseRuntimeSnapshot("global")).toMatchObject({
      status: "running",
      statusHint: "Example",
      pageUrl: "https://example.com",
      pageCount: 2,
      cookieCount: 3,
    });
  });
});
