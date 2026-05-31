import { describe, expect, test } from "bun:test";
import {
  CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
  resolveCursorLocalModelId,
} from "./cursorSdkModel.ts";

describe("resolveCursorLocalModelId", () => {
  test("maps auto alias to default model id", () => {
    expect(resolveCursorLocalModelId("auto")).toBe(CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID);
  });

  test("keeps explicit model ids", () => {
    expect(resolveCursorLocalModelId("composer-2.5")).toBe("composer-2.5");
  });

  test("defaults empty to default model id", () => {
    expect(resolveCursorLocalModelId(undefined)).toBe(CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID);
  });
});
