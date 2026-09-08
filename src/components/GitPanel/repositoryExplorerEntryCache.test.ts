import { expect, test } from "bun:test";
import {
  clearRepositoryExplorerRootChildrenCacheForTests,
  ensureRepositoryExplorerRootChildren,
  getCachedRepositoryExplorerRootChildren,
  prefetchRepositoryExplorer,
  setCachedRepositoryExplorerRootChildren,
  setRepositoryExplorerListImplForTests,
} from "./repositoryExplorerEntryCache";

test("已有文件树缓存时预加载直接跳过，空路径不写入", () => {
  clearRepositoryExplorerRootChildrenCacheForTests();
  prefetchRepositoryExplorer("  ");
  expect(getCachedRepositoryExplorerRootChildren("/work/repo")).toBeUndefined();
  setCachedRepositoryExplorerRootChildren("/work/repo", [{ path: "src", isDir: true }]);
  prefetchRepositoryExplorer("/work/repo");
  expect(getCachedRepositoryExplorerRootChildren("/work/repo")).toEqual([
    { path: "src", isDir: true },
  ]);
});

test("悬停预取与切仓 listing 共用同一次根目录 IPC", async () => {
  clearRepositoryExplorerRootChildrenCacheForTests();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setRepositoryExplorerListImplForTests(async () => {
    calls += 1;
    await gate;
    return [{ path: "src", isDir: true }];
  });
  try {
    prefetchRepositoryExplorer("/work/repo");
    const listing = ensureRepositoryExplorerRootChildren("/work/repo");
    expect(calls).toBe(1);
    release();
    await listing;
    expect(getCachedRepositoryExplorerRootChildren("/work/repo")).toEqual([
      { path: "src", isDir: true },
    ]);
    expect(calls).toBe(1);
  } finally {
    setRepositoryExplorerListImplForTests(null);
    clearRepositoryExplorerRootChildrenCacheForTests();
  }
});
