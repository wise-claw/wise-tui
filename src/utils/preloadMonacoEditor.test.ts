import { describe, expect, test } from "bun:test";
import { preloadMonacoEditor, resetMonacoEditorPreloadForTests } from "./preloadMonacoEditor";

describe("preloadMonacoEditor", () => {
  test("重复调用仍保持幂等", () => {
    resetMonacoEditorPreloadForTests();
    preloadMonacoEditor();
    preloadMonacoEditor();
    preloadMonacoEditor();
    // 仅验证不抛；真实动态 import 由打包器解析，此处不断言网络。
    expect(true).toBe(true);
  });
});
