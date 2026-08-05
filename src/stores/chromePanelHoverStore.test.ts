import { describe, expect, test } from "bun:test";
import {
  isChromePanelHovered,
  isChromeScrollReliefActive,
  isFileTreeScrollActive,
  isSidePanelPriorityReliefActive,
  isWorkspacePriorityReliefActive,
  isWorkspaceScrollActive,
  resetChromePanelHoverStoreForTests,
  scheduleAfterChromeScrollIdle,
  setChromePanelHovered,
  setFileTreeScrollActive,
  setLeftSidebarScrollActive,
  setWorkspacePointerActive,
  setWorkspaceScrollActive,
} from "./chromePanelHoverStore";

describe("chromePanelHoverStore", () => {
  test("tracks left and right panel hover independently", () => {
    resetChromePanelHoverStoreForTests();
    expect(isChromePanelHovered()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);

    setChromePanelHovered("left", true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);

    setChromePanelHovered("left", false);
    setLeftSidebarScrollActive(true);
    expect(isChromePanelHovered()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(true);
    expect(isChromeScrollReliefActive()).toBe(true);

    setLeftSidebarScrollActive(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);
    expect(isChromeScrollReliefActive()).toBe(false);
  });

  test("file tree scroll has dedicated relief flag", () => {
    resetChromePanelHoverStoreForTests();

    setFileTreeScrollActive(true);
    expect(isFileTreeScrollActive()).toBe(true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);
    expect(isChromeScrollReliefActive()).toBe(true);

    setFileTreeScrollActive(false);
    expect(isFileTreeScrollActive()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);
    expect(isChromeScrollReliefActive()).toBe(false);
  });

  test("workspace scroll and pointer have dedicated relief tier", () => {
    resetChromePanelHoverStoreForTests();

    setWorkspaceScrollActive(true);
    expect(isWorkspaceScrollActive()).toBe(true);
    expect(isWorkspacePriorityReliefActive()).toBe(true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);
    expect(isChromeScrollReliefActive()).toBe(true);

    setWorkspaceScrollActive(false);
    setWorkspacePointerActive(true);
    expect(isWorkspacePriorityReliefActive()).toBe(true);
    expect(isChromeScrollReliefActive()).toBe(false);

    setWorkspacePointerActive(false);
    expect(isWorkspacePriorityReliefActive()).toBe(false);
  });

  test("scheduleAfterChromeScrollIdle runs immediately when idle", () => {
    resetChromePanelHoverStoreForTests();
    let ran = 0;
    scheduleAfterChromeScrollIdle(() => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });

  test("scheduleAfterChromeScrollIdle defers while scroll relief is active", async () => {
    resetChromePanelHoverStoreForTests();
    setLeftSidebarScrollActive(true);
    let ran = 0;
    scheduleAfterChromeScrollIdle(() => {
      ran += 1;
    });
    expect(ran).toBe(0);
    expect(isChromeScrollReliefActive()).toBe(true);

    setLeftSidebarScrollActive(false);
    const start = Date.now();
    while (ran !== 1 && Date.now() - start < 500) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    expect(ran).toBe(1);
  });
});
