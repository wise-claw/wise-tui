import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import { estimateDaysFromSize, sameApiSpec, taskToMarkdown } from "./helpers";

const baseTask: TaskItem = {
  id: "t1",
  title: "示例任务",
  description: "  示例描述\n",
  role: "fullstack",
  size: "M",
  subtasks: ["子任务一", "子任务二"],
  dod: ["验收一", "验收二"],
} as unknown as TaskItem;

describe("taskToMarkdown", () => {
  test("trims description and renders subtasks + DoD", () => {
    const md = taskToMarkdown(baseTask);
    expect(md.startsWith("#### 任务内容\n示例描述")).toBe(true);
    expect(md).toContain("#### 子任务\n- 子任务一\n- 子任务二");
    expect(md).toContain("#### 验收标准（DoD）\n- 验收一\n- 验收二");
    expect(md.includes("#### 接口协议")).toBe(false);
  });

  test("includes interface protocol when apiSpec is present", () => {
    const md = taskToMarkdown({
      ...baseTask,
      apiSpec: {
        endpoint: "/api/x",
        method: "POST",
        requestSchema: "{}",
        responseSchema: "{}",
        errorCodes: ["400", "500"],
      },
    } as unknown as TaskItem);
    expect(md).toContain("#### 接口协议");
    expect(md).toContain("- 接口路径：/api/x");
    expect(md).toContain("- 请求方法：POST");
    expect(md).toContain("- 错误码：400, 500");
  });

  test("error code line falls back to '无' when empty", () => {
    const md = taskToMarkdown({
      ...baseTask,
      apiSpec: {
        endpoint: "/api/x",
        method: "GET",
        requestSchema: "",
        responseSchema: "",
        errorCodes: [],
      },
    } as unknown as TaskItem);
    expect(md).toContain("- 错误码：无");
  });
});

describe("estimateDaysFromSize", () => {
  test("returns 1 for S", () => {
    expect(estimateDaysFromSize("S")).toBe(1);
  });
  test("returns 2 for M", () => {
    expect(estimateDaysFromSize("M")).toBe(2);
  });
  test("returns 4 for L", () => {
    expect(estimateDaysFromSize("L")).toBe(4);
  });
});

describe("sameApiSpec", () => {
  const a = {
    endpoint: "/x",
    method: "POST",
    requestSchema: "{}",
    responseSchema: "{}",
    errorCodes: ["400"],
  };
  test("both undefined → equal", () => {
    expect(sameApiSpec(undefined, undefined)).toBe(true);
  });
  test("one undefined → not equal", () => {
    expect(sameApiSpec(a as never, undefined)).toBe(false);
  });
  test("identical → equal", () => {
    expect(sameApiSpec(a as never, { ...a } as never)).toBe(true);
  });
  test("different error codes → not equal", () => {
    expect(sameApiSpec(a as never, { ...a, errorCodes: ["500"] } as never)).toBe(false);
  });
  test("different endpoint → not equal", () => {
    expect(sameApiSpec(a as never, { ...a, endpoint: "/y" } as never)).toBe(false);
  });
});
