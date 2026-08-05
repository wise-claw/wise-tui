import { describe, expect, test } from "bun:test";
import {
  resolveStreamingRebuildMinMs,
  shouldDegradeStreamingToPlain,
} from "./useMarkdownDisplaySource";

const TABLE = ["| 名称 | 说明 |", "| --- | --- |", "| a | 第一项 |"].join("\n");
const FENCE = ["```ts", "const a = 1;", "```"].join("\n");

describe("shouldDegradeStreamingToPlain", () => {
  test("表格与代码围栏在流式期仍走 Markdown 渲染", () => {
    expect(shouldDegradeStreamingToPlain(TABLE, false)).toBe(false);
    expect(shouldDegradeStreamingToPlain(TABLE, true)).toBe(false);
    expect(shouldDegradeStreamingToPlain(FENCE, false)).toBe(false);
    expect(shouldDegradeStreamingToPlain(FENCE, true)).toBe(false);
  });

  test("中等长度正文不降级", () => {
    expect(shouldDegradeStreamingToPlain("字".repeat(5000), true)).toBe(false);
  });

  test("仅在主线程拥堵且正文极长时降级", () => {
    const huge = "字".repeat(20000);
    expect(shouldDegradeStreamingToPlain(huge, false)).toBe(false);
    expect(shouldDegradeStreamingToPlain(huge, true)).toBe(true);
  });
});

describe("resolveStreamingRebuildMinMs", () => {
  test("拥堵时优先让步", () => {
    expect(resolveStreamingRebuildMinMs(10, true)).toBe(220);
    expect(resolveStreamingRebuildMinMs(100000, true)).toBe(220);
  });

  test("侧栏滚动让路强于拥堵", () => {
    expect(
      resolveStreamingRebuildMinMs(10, { congested: true, scrollRelief: true }),
    ).toBe(360);
    expect(
      resolveStreamingRebuildMinMs(10, { congested: false, scrollRelief: true }),
    ).toBe(360);
  });

  test("空闲时按正文规模放宽", () => {
    expect(resolveStreamingRebuildMinMs(10, false)).toBe(100);
    expect(resolveStreamingRebuildMinMs(5999, false)).toBe(100);
    expect(resolveStreamingRebuildMinMs(6000, false)).toBe(240);
  });
});
