import { describe, expect, test } from "bun:test";
import {
  assertEditorDiffPayloadWithinLimit,
  isFileEditorTabDirty,
  mergeEditorRefreshScope,
  planEditorTabRefresh,
  shouldReleaseInactiveHugeTabContent,
  type FileEditorTab,
} from "./useRepositoryFileEditor";
import {
  EDITOR_FILE_MAX_BYTES,
  MONACO_HUGE_FILE_CHAR_THRESHOLD,
} from "../utils/monacoLargeFile";
import { editorDiskStatUnchanged } from "../services/projectRelativeFiles";

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

  test("正文已释放的 tab 跳过普通对比（避免空 original 误判）", () => {
    const tab = makeTab({
      content: "",
      originalContent: "",
      contentReleased: true,
    });
    const decision = planEditorTabRefresh({
      tab,
      effectiveContent: "",
      diskContent: "disk-body",
      isSaving: false,
    });
    expect(decision).toEqual({ kind: "skip", reason: "released" });
  });
});

describe("shouldReleaseInactiveHugeTabContent", () => {
  const huge = "x".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD);

  test("非活跃、干净、huge → 应释放", () => {
    const tab = makeTab({ content: huge, originalContent: huge });
    expect(
      shouldReleaseInactiveHugeTabContent({ tab, isActive: false }),
    ).toBe(true);
  });

  test("活跃 tab 不释放", () => {
    const tab = makeTab({ content: huge, originalContent: huge });
    expect(
      shouldReleaseInactiveHugeTabContent({ tab, isActive: true }),
    ).toBe(false);
  });

  test("脏 tab / 已释放 / diff / 非 huge 不释放", () => {
    expect(
      shouldReleaseInactiveHugeTabContent({
        tab: makeTab({ content: huge, originalContent: huge }),
        isActive: false,
        pending: `${huge}!`,
      }),
    ).toBe(false);
    expect(
      shouldReleaseInactiveHugeTabContent({
        tab: makeTab({
          content: "",
          originalContent: "",
          contentReleased: true,
        }),
        isActive: false,
      }),
    ).toBe(false);
    expect(
      shouldReleaseInactiveHugeTabContent({
        tab: makeTab({ content: huge, originalContent: huge, diffOriginal: "base" }),
        isActive: false,
      }),
    ).toBe(false);
    expect(
      shouldReleaseInactiveHugeTabContent({
        tab: makeTab({ content: "small", originalContent: "small" }),
        isActive: false,
      }),
    ).toBe(false);
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

describe("isFileEditorTabDirty", () => {
  test("同一引用视为干净", () => {
    const body = "same";
    const tab = makeTab({ content: body, originalContent: body });
    expect(isFileEditorTabDirty(tab)).toBe(false);
  });

  test("length 不同直接判定脏", () => {
    const tab = makeTab({ content: "ab", originalContent: "a" });
    expect(isFileEditorTabDirty(tab)).toBe(true);
  });

  test("pending 覆盖 content 参与判定", () => {
    const tab = makeTab({ content: "original", originalContent: "original" });
    expect(isFileEditorTabDirty(tab, "changed")).toBe(true);
    expect(isFileEditorTabDirty(tab, "original")).toBe(false);
  });

  test("contentReleased 视为干净", () => {
    const tab = makeTab({
      content: "",
      originalContent: "",
      contentReleased: true,
    });
    expect(isFileEditorTabDirty(tab)).toBe(false);
    expect(isFileEditorTabDirty(tab, "stale-pending")).toBe(false);
  });
});

describe("assertEditorDiffPayloadWithinLimit", () => {
  test("两侧均未超限时不抛", () => {
    expect(() => assertEditorDiffPayloadWithinLimit("a", "b")).not.toThrow();
  });

  test("任一侧超限时抛出编辑器上限错误", () => {
    const huge = "x".repeat(EDITOR_FILE_MAX_BYTES + 1);
    expect(() => assertEditorDiffPayloadWithinLimit(huge, "ok")).toThrow(/4MB/);
    expect(() => assertEditorDiffPayloadWithinLimit("ok", huge)).toThrow(/4MB/);
  });
});

describe("editorDiskStatUnchanged", () => {
  test("无既往 fingerprint 视为已变（需全文读）", () => {
    expect(editorDiskStatUnchanged(undefined, { mtimeMs: 1, byteLen: 10 })).toBe(false);
  });

  test("mtime 与 size 均相同视为未变", () => {
    const stat = { mtimeMs: 100, byteLen: 2048 };
    expect(editorDiskStatUnchanged(stat, { ...stat })).toBe(true);
    expect(editorDiskStatUnchanged(stat, { mtimeMs: 101, byteLen: 2048 })).toBe(false);
    expect(editorDiskStatUnchanged(stat, { mtimeMs: 100, byteLen: 2049 })).toBe(false);
  });
});
