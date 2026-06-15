import { describe, expect, test } from "bun:test";
import {
  CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
  isCursorSdkModelId,
  resolveCursorLocalModelId,
} from "./cursorSdkModel.ts";

describe("isCursorSdkModelId", () => {
  test("rejects glm proxy models", () => {
    expect(isCursorSdkModelId("glm-5.1")).toBe(false);
    expect(isCursorSdkModelId("composer-2.5")).toBe(true);
  });
});

describe("resolveCursorLocalModelId", () => {
  test("maps auto alias to Local SDK default id", () => {
    expect(resolveCursorLocalModelId("auto")).toBe("composer-2.5");
    expect(CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID).toBe("composer-2.5");
  });

  test("keeps explicit model ids", () => {
    expect(resolveCursorLocalModelId("composer-2.5")).toBe("composer-2.5");
  });

  test("defaults empty to default model id", () => {
    expect(resolveCursorLocalModelId(undefined)).toBe(CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID);
  });

  test("falls back to default for glm proxy models", () => {
    expect(resolveCursorLocalModelId("glm-5.1")).toBe(CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID);
  });
});
