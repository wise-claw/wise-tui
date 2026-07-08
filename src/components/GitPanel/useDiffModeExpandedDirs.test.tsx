import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, create } from "react-test-renderer";
import { useLayoutEffect, useState } from "react";
import { useDiffModeExpandedDirs, type UseDiffModeExpandedDirsApi } from "./useDiffModeExpandedDirs";

const STORAGE_PREFIX = "wise.gitPanel.expanded.v1:";

let domWindow: Window | null = null;
let savedGlobals: Record<string, unknown> = {};

const GLOBAL_KEYS = ["window", "document", "sessionStorage", "localStorage"];

function assignGlobal(key: string, value: unknown): void {
  try {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}

interface Harness {
  get api(): UseDiffModeExpandedDirsApi;
  /** 重设 treeDirPaths，触发 hook 的依赖更新。 */
  setTree(paths: string[]): void;
  unmount(): void;
}

function makeHarness(repositoryPath: string, initialTree: string[]): Harness {
  let api: UseDiffModeExpandedDirsApi | null = null;
  const setterRef: { current: ((paths: string[]) => void) | null } = { current: null };
  let renderer: ReturnType<typeof create> | undefined;

  function Probe() {
    const [paths, setPaths] = useState<string[]>(initialTree);
    setterRef.current = setPaths;
    const result = useDiffModeExpandedDirs(repositoryPath, paths);
    useLayoutEffect(() => {
      api = result;
    });
    return null;
  }

  act(() => {
    renderer = create(<Probe />);
  });
  if (!api) throw new Error("Probe never received api");
  if (!setterRef.current) throw new Error("setter not ready");

  return {
    get api() {
      if (!api) throw new Error("api not ready");
      return api;
    },
    setTree: (paths) => {
      if (!setterRef.current) throw new Error("setter not ready");
      act(() => {
        setterRef.current?.(paths);
      });
    },
    unmount: () => renderer?.unmount(),
  };
}

describe("useDiffModeExpandedDirs", () => {
  beforeEach(() => {
    // 保存原值，afterEach 还原，避免污染其他测试文件的全局状态
    savedGlobals = {};
    for (const key of GLOBAL_KEYS) {
      savedGlobals[key] = (globalThis as unknown as Record<string, unknown>)[key];
    }
    domWindow = new Window();
    assignGlobal("window", domWindow);
    assignGlobal("document", domWindow.document);
    assignGlobal("sessionStorage", domWindow.sessionStorage);
    assignGlobal("localStorage", domWindow.localStorage);
  });

  afterEach(() => {
    if (domWindow) {
      domWindow.close();
      domWindow = null;
    }
    for (const key of GLOBAL_KEYS) {
      const value = savedGlobals[key];
      if (value === undefined) {
        delete (globalThis as unknown as Record<string, unknown>)[key];
      } else {
        assignGlobal(key, value);
      }
    }
  });

  test("首次进入无持久化：默认展开所有顶层目录（不递归）", () => {
    const harness = makeHarness("/repo/a", ["src", "src/components", "tests", "docs"]);
    // 顶层：src / tests / docs（不含 / 的）；子目录 src/components 应默认收起
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    expect(harness.api.expandedDirs.has("tests")).toBe(true);
    expect(harness.api.expandedDirs.has("docs")).toBe(true);
    expect(harness.api.expandedDirs.has("src/components")).toBe(false);
    harness.unmount();
  });

  test("toggle 单个目录：状态翻转并写入 sessionStorage", () => {
    const harness = makeHarness("/repo/b", ["src"]);
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    act(() => {
      harness.api.toggleDir("src");
    });
    expect(harness.api.expandedDirs.has("src")).toBe(false);
    const stored = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}/repo/b`) ?? "[]");
    expect(stored).toEqual([]);
    harness.unmount();
  });

  test("toggle 加上原本不在的目录：写入后该 path 持久化", () => {
    // 仅一个顶层目录 src，先收起后再 toggle 子目录，避免被默认初始值干扰
    const harness = makeHarness("/repo/c", ["src", "src/components"]);
    act(() => {
      harness.api.collapseAll();
    });
    act(() => {
      harness.api.toggleDir("src/components");
    });
    expect(harness.api.expandedDirs.has("src/components")).toBe(true);
    expect(harness.api.expandedDirs.has("src")).toBe(false);
    const stored = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}/repo/c`) ?? "[]");
    expect(stored).toEqual(["src/components"]);
    harness.unmount();
  });

  test("跨挂载读取持久化：新 harness 恢复上次状态", () => {
    const h1 = makeHarness("/repo/d", ["src", "tests"]);
    act(() => {
      h1.api.collapseAll();
    });
    expect(h1.api.expandedDirs.size).toBe(0);
    h1.unmount();

    const h2 = makeHarness("/repo/d", ["src", "tests"]);
    expect(h2.api.expandedDirs.size).toBe(0);
    h2.unmount();
  });

  test("prune 过期 path：treeDirPaths 不再包含某目录时自动从 expandedDirs 移除", () => {
    const harness = makeHarness("/repo/e", ["src", "tests"]);
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    expect(harness.api.expandedDirs.has("tests")).toBe(true);

    // 模拟 commit 后 src 目录消失（树重算后只有 tests）
    harness.setTree(["tests"]);
    expect(harness.api.expandedDirs.has("src")).toBe(false);
    expect(harness.api.expandedDirs.has("tests")).toBe(true);
    harness.unmount();
  });

  test("expandAll / collapseAll 行为正确", () => {
    const harness = makeHarness("/repo/f", ["src", "tests", "docs"]);
    act(() => {
      harness.api.collapseAll();
    });
    expect(harness.api.expandedDirs.size).toBe(0);
    expect(harness.api.isTreeAllExpanded).toBe(false);

    act(() => {
      harness.api.expandAll(["src", "tests", "docs"]);
    });
    expect(harness.api.expandedDirs.size).toBe(3);
    expect(harness.api.isTreeAllExpanded).toBe(true);
    harness.unmount();
  });

  test("不同仓库使用独立持久化 key", () => {
    const h1 = makeHarness("/repo/g1", ["src"]);
    act(() => {
      h1.api.collapseAll();
    });
    h1.unmount();

    const h2 = makeHarness("/repo/g2", ["src"]);
    // g2 没有持久化，应回到默认（顶层全展开）
    expect(h2.api.expandedDirs.has("src")).toBe(true);
    h2.unmount();
  });

  test("sessionStorage 损坏数据时降级到默认", () => {
    sessionStorage.setItem(`${STORAGE_PREFIX}/repo/h`, "{not json");
    const harness = makeHarness("/repo/h", ["src", "tests"]);
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    expect(harness.api.expandedDirs.has("tests")).toBe(true);
    expect(harness.api.expandedDirs.has("src/components")).toBe(false);
    harness.unmount();
  });

  test("toggleDirRecursive：收起 → 全部展开（含多层子目录）；展开 → 全部收起", () => {
    const harness = makeHarness("/repo/i", ["src", "src/components", "src/components/Button", "tests"]);
    // 默认：src / tests（顶层）已展开；嵌套子目录未展开
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    expect(harness.api.expandedDirs.has("src/components")).toBe(false);
    expect(harness.api.expandedDirs.has("src/components/Button")).toBe(false);

    // 第一次 toggle：src 已展开 → 全部收起
    act(() => {
      harness.api.toggleDirRecursive("src", ["src", "src/components", "src/components/Button"]);
    });
    expect(harness.api.expandedDirs.has("src")).toBe(false);
    expect(harness.api.expandedDirs.has("src/components")).toBe(false);
    expect(harness.api.expandedDirs.has("src/components/Button")).toBe(false);
    // 不在子树内的其他顶层目录（tests）不受影响
    expect(harness.api.expandedDirs.has("tests")).toBe(true);

    // 第二次 toggle：src 已收起 → 全部展开
    act(() => {
      harness.api.toggleDirRecursive("src", ["src", "src/components", "src/components/Button"]);
    });
    expect(harness.api.expandedDirs.has("src")).toBe(true);
    expect(harness.api.expandedDirs.has("src/components")).toBe(true);
    expect(harness.api.expandedDirs.has("src/components/Button")).toBe(true);
    expect(harness.api.expandedDirs.has("tests")).toBe(true);
    harness.unmount();
  });
});