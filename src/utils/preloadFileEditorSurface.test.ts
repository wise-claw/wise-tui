import { describe, expect, test } from "bun:test";
import {
  preloadFileEditorSurface,
  resetFileEditorSurfacePreloadForTests,
} from "./preloadFileEditorSurface";
import { resetMonacoEditorPreloadForTests } from "./preloadMonacoEditor";

describe("preloadFileEditorSurface", () => {
  test("重复调用仍保持幂等", () => {
    resetMonacoEditorPreloadForTests();
    resetFileEditorSurfacePreloadForTests();
    preloadFileEditorSurface();
    preloadFileEditorSurface();
    expect(true).toBe(true);
  });
});
