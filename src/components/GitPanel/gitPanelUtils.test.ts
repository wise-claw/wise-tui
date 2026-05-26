import { describe, expect, it } from "bun:test";
import {
  GIT_PANEL_LARGE_CHANGE_COUNT,
  shouldUseGitVirtualFileList,
} from "./gitPanelUtils";

describe("shouldUseGitVirtualFileList", () => {
  it("enables virtualization above the large-change threshold", () => {
    expect(shouldUseGitVirtualFileList(GIT_PANEL_LARGE_CHANGE_COUNT)).toBe(false);
    expect(shouldUseGitVirtualFileList(GIT_PANEL_LARGE_CHANGE_COUNT + 1)).toBe(true);
  });
});
