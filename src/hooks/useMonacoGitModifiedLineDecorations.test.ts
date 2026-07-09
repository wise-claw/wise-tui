import { describe, expect, it } from "bun:test";
import {
  pickDirtyDiffRefreshAction,
  shouldRunDecorationRefreshNow,
} from "./useMonacoGitModifiedLineDecorations";

describe("shouldRunDecorationRefreshNow", () => {
  it("编辑器聚焦时即使 defer 也立即执行（用户在看着编辑器，延迟会很明显）", () => {
    expect(shouldRunDecorationRefreshNow(true, true)).toBe(true);
  });

  it("失焦 + 不 defer 时立即执行（用户可能仍在打字/改文档）", () => {
    expect(shouldRunDecorationRefreshNow(false, false)).toBe(true);
  });

  it("失焦 + defer 时推迟到下个空闲帧（关键不变量：不能整段丢）", () => {
    expect(shouldRunDecorationRefreshNow(true, false)).toBe(false);
  });

  it("聚焦 + 不 defer 时立即执行", () => {
    expect(shouldRunDecorationRefreshNow(false, true)).toBe(true);
  });
});

describe("pickDirtyDiffRefreshAction", () => {
  it("current 为 null（模型不存在/编辑器卸载中）时跳过", () => {
    expect(pickDirtyDiffRefreshAction({ baseline: "a", current: null })).toEqual({
      kind: "skip",
    });
  });

  it("current ≠ baseline 时走本地对比（用户本地有未保存改动）", () => {
    expect(pickDirtyDiffRefreshAction({ baseline: "a\nb", current: "a\nX" })).toEqual({
      kind: "local",
      baseline: "a\nb",
      current: "a\nX",
    });
  });

  it("current === baseline 时走 clean 路径（先清本地装饰再异步读 HEAD）", () => {
    expect(pickDirtyDiffRefreshAction({ baseline: "a\nb", current: "a\nb" })).toEqual({
      kind: "clean",
      current: "a\nb",
    });
  });

  it("baseline 与 current 都是空串时仍判定为 clean（保存空文件后）", () => {
    expect(pickDirtyDiffRefreshAction({ baseline: "", current: "" })).toEqual({
      kind: "clean",
      current: "",
    });
  });
});