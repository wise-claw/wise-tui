import { describe, expect, test } from "bun:test";
import {
  isChromePanelHovered,
  isFileTreeScrollActive,
  isSidePanelPriorityReliefActive,
  isWorkspacePriorityReliefActive,
  isWorkspaceScrollActive,
  setChromePanelHovered,
  setFileTreeScrollActive,
  setLeftSidebarScrollActive,
  setWorkspacePointerActive,
  setWorkspaceScrollActive,
} from "./chromePanelHoverStore";

describe("chromePanelHoverStore", () => {
  test("tracks left and right panel hover independently", () => {
    setChromePanelHovered("left", false);
    setChromePanelHovered("right", false);
    setLeftSidebarScrollActive(false);
    setFileTreeScrollActive(false);
    setWorkspaceScrollActive(false);
    setWorkspacePointerActive(false);
    expect(isChromePanelHovered()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);

    setChromePanelHovered("left", true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);

    setChromePanelHovered("left", false);
    setLeftSidebarScrollActive(true);
    expect(isChromePanelHovered()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(true);

    setLeftSidebarScrollActive(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);
  });

  test("file tree scroll has dedicated relief flag", () => {
    setChromePanelHovered("left", false);
    setChromePanelHovered("right", false);
    setLeftSidebarScrollActive(false);
    setFileTreeScrollActive(false);

    setFileTreeScrollActive(true);
    expect(isFileTreeScrollActive()).toBe(true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);

    setFileTreeScrollActive(false);
    expect(isFileTreeScrollActive()).toBe(false);
    expect(isSidePanelPriorityReliefActive()).toBe(false);
  });

  test("workspace scroll and pointer have dedicated relief tier", () => {
    setChromePanelHovered("left", false);
    setChromePanelHovered("right", false);
    setLeftSidebarScrollActive(false);
    setFileTreeScrollActive(false);
    setWorkspaceScrollActive(false);
    setWorkspacePointerActive(false);

    setWorkspaceScrollActive(true);
    expect(isWorkspaceScrollActive()).toBe(true);
    expect(isWorkspacePriorityReliefActive()).toBe(true);
    expect(isSidePanelPriorityReliefActive()).toBe(true);

    setWorkspaceScrollActive(false);
    setWorkspacePointerActive(true);
    expect(isWorkspacePriorityReliefActive()).toBe(true);

    setWorkspacePointerActive(false);
    expect(isWorkspacePriorityReliefActive()).toBe(false);
  });
});
