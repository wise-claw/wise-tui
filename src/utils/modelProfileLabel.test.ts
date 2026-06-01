import { describe, expect, test } from "bun:test";
import {
  normalizeModelProfileLabelInput,
  validateModelProfileLabel,
} from "./modelProfileLabel.ts";

describe("normalizeModelProfileLabelInput", () => {
  test("keeps digits dots and dashes", () => {
    expect(normalizeModelProfileLabelInput("百炼-v2.0")).toBe("百炼-v2.0");
    expect(normalizeModelProfileLabelInput("glm-5.1")).toBe("glm-5.1");
    expect(normalizeModelProfileLabelInput("Qwen_3.6")).toBe("Qwen_3.6");
  });

  test("strips path separators and control chars", () => {
    expect(normalizeModelProfileLabelInput("a/b\\c")).toBe("abc");
    expect(normalizeModelProfileLabelInput("a\u0001b")).toBe("ab");
  });
});

describe("validateModelProfileLabel", () => {
  test("allows common special characters", () => {
    expect(
      validateModelProfileLabel("MiniMax-M2.5", { field: "名称", required: true }),
    ).toBeNull();
    expect(validateModelProfileLabel("百炼.qwen-3", { field: "公司" })).toBeNull();
  });

  test("rejects empty when required", () => {
    expect(validateModelProfileLabel("  ", { field: "名称", required: true })).toBe(
      "请输入名称",
    );
  });
});
