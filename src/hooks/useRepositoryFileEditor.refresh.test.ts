import { describe, expect, test } from "bun:test";
import {
  mergeEditorRefreshScope,
  planEditorTabRefresh,
  type FileEditorTab,
} from "./useRepositoryFileEditor";

/** 构造一个普通（非 diff）已加载完成的 tab 工厂。 */
function makeTab(overrides: Partial<FileEditorTab> = {}): FileEditorTab {
  return {
    relativePath: "src/app.ts",
    rootPath: "/repo/demo",
    content: "original",
    originalContent: "original",
    loading: false,
    ...overrides,
  };
}

describe("planEditorTabRefresh", () => {
  test("loading 中的 tab 跳过", () => {
    const tab = makeTab({ loading: true });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "skip", reason: "loading" });
  });

  test("diff 只读视图跳过", () => {
    const tab = makeTab({ diffOriginal: "base" });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "skip", reason: "diff" });
  });

  test("正在保存的 tab 跳过", () => {
    const tab = makeTab();
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "changed",
      isSaving: true,
    });
    expect(decision).toEqual({ kind: "skip", reason: "saving" });
  });

  test("磁盘读取失败（文件被删除）标记 external-deleted", () => {
    const tab = makeTab();
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: null,
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "external-deleted" });
  });

  test("磁盘内容未变 -> unchanged", () => {
    const tab = makeTab();
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "original",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "unchanged" });
  });

  test("磁盘内容变回与 originalContent 一致且原已标记变更 -> 清除标志", () => {
    const tab = makeTab({ externalChanged: true });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "edited",
      diskContent: "original",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "clear-external-flag" });
  });

  test("干净 tab + 磁盘已变 -> reload-clean", () => {
    const tab = makeTab();
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "reload-clean", disk: "changed" });
  });

  test("脏 tab + 磁盘已变 -> 仅标记 mark-external-changed（不覆盖）", () => {
    const tab = makeTab({ content: "edited" });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "edited",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "mark-external-changed" });
  });

  test("大文件脏 tab：tab.content===originalContent 但 effectiveContent(待写入)不同 -> 判定为脏，走 mark-external-changed", () => {
    // 模拟大文件：用户编辑存于 pendingTabContentRef 尚未 flush，tab.content 仍等于 originalContent。
    const tab = makeTab({ content: "original", originalContent: "original" });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "edited-not-yet-flushed",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "mark-external-changed" });
  });

  test("大文件干净 tab：effectiveContent===originalContent -> reload-clean", () => {
    const tab = makeTab({ content: "original", originalContent: "original" });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "original",
      diskContent: "changed",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "reload-clean", disk: "changed" });
  });
});

describe("mergeEditorRefreshScope", () => {
  test("无待执行 + 限定仓库 -> 该仓库", () => {
    expect(mergeEditorRefreshScope(undefined, "repoA")).toBe("repoA");
  });

  test("无待执行 + 全量 -> 全量", () => {
    expect(mergeEditorRefreshScope(undefined, null)).toBeNull();
  });

  test("已全量 + 限定仓库 -> 保持全量（不被降级）", () => {
    expect(mergeEditorRefreshScope(null, "repoA")).toBeNull();
  });

  test("限定仓库 + 全量 -> 升级全量", () => {
    expect(mergeEditorRefreshScope("repoA", null)).toBeNull();
  });

  test("同仓库 + 同仓库 -> 保持", () => {
    expect(mergeEditorRefreshScope("repoA", "repoA")).toBe("repoA");
  });

  test("不同仓库 -> 升级全量（避免多仓库漏刷）", () => {
    expect(mergeEditorRefreshScope("repoA", "repoB")).toBeNull();
  });
});
