import { beforeEach, describe, expect, it } from "bun:test";
import {
  resolveExplorerRevealTargetForOpen,
  resolveVisibleExplorerRevealTarget,
} from "./explorerRevealTarget";

function installLocalStorageMock(): void {
  const storage = new Map<string, string>();
  const mock = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  } as Storage;
  globalThis.localStorage = mock;
  if (typeof globalThis.window !== "undefined") {
    Object.defineProperty(globalThis.window, "localStorage", {
      configurable: true,
      value: mock,
    });
  }
}

describe("explorerRevealTarget", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });
  const baseInput = {
    workspaceFileTreeRailOpen: false,
    filesPanelPlacement: "left" as const,
    gitPanelPlacement: "left" as const,
    leftSidebarCollapsed: false,
    leftSidebarParked: false,
    rightRailAvailable: true,
  };

  it("uses workspace rail when it is the only visible file tree", () => {
    localStorage.setItem("wise.leftPanel.bottomTab", "git");

    expect(resolveVisibleExplorerRevealTarget(baseInput)).toBeNull();
    expect(
      resolveVisibleExplorerRevealTarget({
        ...baseInput,
        workspaceFileTreeRailOpen: true,
      }),
    ).toBe("workspace-rail");
  });

  it("defaults to left sidebar instead of opening workspace rail when files live on the left", () => {
    localStorage.setItem("wise.leftPanel.bottomTab", "git");

    expect(resolveExplorerRevealTargetForOpen(baseInput)).toBe("left-sidebar");
  });
});
