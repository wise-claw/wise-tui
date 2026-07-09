import { describe, expect, test } from "bun:test";
import { mdPreviewReducer } from "./useRepositoryFileEditor";

/**
 * `mdPreviewReducer` 的键空间语义单测。
 *
 * 写入/读取必须用同一套 `${rootPath}::${relativePath}` 键，否则会出现"保存时用 rootPath
 * 前缀，读时仅用 relativePath"，导致 md 文件预览分支永不渲染的回归。本组用例同时也是
 * 该 reducer 的契约基线，未来如改键名/拼装策略，必须同步更新断言。
 */
describe("mdPreviewReducer 键空间", () => {
  test("写入 (rootPath, relativePath)=true 后键为 `${rootPath}::${relativePath}`", () => {
    const next = mdPreviewReducer(
      {},
      { rootPath: "/repo/a", relativePath: "README.md", value: true },
    );
    expect(next).toEqual({ "/repo/a::README.md": true });
    // 反例：旧实现（仅按 relativePath 索引）会读到该 raw key —— 现在应不存在。
    expect(next["README.md"]).toBeUndefined();
  });

  test("不同 rootPath 同 relativePath 各自独立，互不覆盖", () => {
    const a = mdPreviewReducer(
      {},
      { rootPath: "/repo/a", relativePath: "README.md", value: true },
    );
    const b = mdPreviewReducer(a, {
      rootPath: "/repo/b",
      relativePath: "README.md",
      value: true,
    });
    expect(b["/repo/a::README.md"]).toBe(true);
    expect(b["/repo/b::README.md"]).toBe(true);
    // 单独关闭其中一项不影响另一项
    const cleared = mdPreviewReducer(b, {
      rootPath: "/repo/a",
      relativePath: "README.md",
      value: false,
    });
    expect(cleared["/repo/a::README.md"]).toBeUndefined();
    expect(cleared["/repo/b::README.md"]).toBe(true);
  });

  test("同 key 真值幂等（不变引用）", () => {
    const a = mdPreviewReducer(
      {},
      { rootPath: "/repo/a", relativePath: "README.md", value: true },
    );
    const b = mdPreviewReducer(a, {
      rootPath: "/repo/a",
      relativePath: "README.md",
      value: true,
    });
    // useState 合并需要引用稳定，否则会无意义触发下游 re-render
    expect(b).toBe(a);
  });

  test("写 false 仅删该 key，其它 key 保留", () => {
    const a = mdPreviewReducer(
      {},
      { rootPath: "/repo/a", relativePath: "x.md", value: true },
    );
    const b = mdPreviewReducer(a, {
      rootPath: "/repo/a",
      relativePath: "y.md",
      value: true,
    });
    const c = mdPreviewReducer(b, {
      rootPath: "/repo/a",
      relativePath: "x.md",
      value: false,
    });
    expect(c["/repo/a::x.md"]).toBeUndefined();
    expect(c["/repo/a::y.md"]).toBe(true);
  });

  test("写 false 在不存在 key 上幂等（引用不变）", () => {
    const a = mdPreviewReducer(
      {},
      { rootPath: "/repo/a", relativePath: "absent.md", value: false },
    );
    expect(a).toEqual({});
    // 第二次写 false 仍引用稳定
    const b = mdPreviewReducer(a, {
      rootPath: "/repo/b",
      relativePath: "another.md",
      value: false,
    });
    expect(b).toEqual({});
    expect(b).toBe(a);
  });
});
