import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearPendingExplorerReveal,
  consumePendingExplorerReveal,
  WISE_EXPLORER_REVEAL_REQUESTED,
  writePendingExplorerReveal,
} from "./pendingExplorerReveal";

function installSessionStorageMock(): void {
  const storage = new Map<string, string>();
  globalThis.sessionStorage = {
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
}

describe("pendingExplorerReveal", () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  it("writes session storage and dispatches reveal event", () => {
    if (typeof window === "undefined") return;
    let received: unknown = null;
    const handler = (event: Event) => {
      received = (event as CustomEvent).detail;
    };
    window.addEventListener(WISE_EXPLORER_REVEAL_REQUESTED, handler);
    try {
      writePendingExplorerReveal({
        repositoryPath: "/repo",
        relativePath: "extras/foo.mjs",
        isDirectory: false,
        revealTarget: "left-sidebar",
      });
      expect(received).toEqual({
        repositoryPath: "/repo",
        relativePath: "extras/foo.mjs",
        isDirectory: false,
        revealTarget: "left-sidebar",
      });
      expect(consumePendingExplorerReveal("/repo", "left-sidebar")).toEqual({
        repositoryPath: "/repo",
        relativePath: "extras/foo.mjs",
        isDirectory: false,
        revealTarget: "left-sidebar",
      });
    } finally {
      window.removeEventListener(WISE_EXPLORER_REVEAL_REQUESTED, handler);
      clearPendingExplorerReveal();
    }
  });

  it("ignores pending reveal for a different repository", () => {
    writePendingExplorerReveal({
      repositoryPath: "/repo-a",
      relativePath: "src/index.ts",
      isDirectory: false,
      revealTarget: "workspace-rail",
    });
    expect(consumePendingExplorerReveal("/repo-b", "workspace-rail")).toBeNull();
    expect(sessionStorage.getItem("wise/pending-explorer-reveal")).not.toBeNull();
    clearPendingExplorerReveal();
  });

  it("does not consume pending reveal for a different file tree instance", () => {
    writePendingExplorerReveal({
      repositoryPath: "/repo",
      relativePath: "src/index.ts",
      isDirectory: false,
      revealTarget: "left-sidebar",
    });
    expect(consumePendingExplorerReveal("/repo", "workspace-rail")).toBeNull();
    expect(consumePendingExplorerReveal("/repo", "left-sidebar")).not.toBeNull();
    clearPendingExplorerReveal();
  });
});
