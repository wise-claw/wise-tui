import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import {
  estimateDaysFromSize,
  parseTaskMarkdownDraft,
  sameApiSpec,
  taskPreviewLine,
  taskToMarkdown,
} from "./helpers";

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

describe("parseTaskMarkdownDraft", () => {
  test("parses sections, lists and trims description", () => {
    const md = [
      "#### 任务内容",
      "示例描述",
      "",
      "#### 子任务",
      "- 子A",
      "- 子B",
      "",
      "#### 验收标准（DoD）",
      "- 验收A",
    ].join("\n");
    const parsed = parseTaskMarkdownDraft(md);
    expect(parsed.description).toBe("示例描述");
    expect(parsed.subtasks).toEqual(["子A", "子B"]);
    expect(parsed.dod).toEqual(["验收A"]);
    expect(parsed.apiSpec).toBeUndefined();
  });

  test("parses apiSpec block including 错误码 list", () => {
    const md = [
      "#### 任务内容",
      "x",
      "",
      "#### 接口协议",
      "- 接口路径：/api/x",
      "- 请求方法：POST",
      "- 请求定义：{}",
      "- 响应定义：{}",
      "- 错误码：400, 500",
      "",
      "#### 子任务",
      "",
      "#### 验收标准（DoD）",
    ].join("\n");
    const parsed = parseTaskMarkdownDraft(md);
    expect(parsed.apiSpec).toBeDefined();
    expect(parsed.apiSpec?.endpoint).toBe("/api/x");
    expect(parsed.apiSpec?.method).toBe("POST");
    expect(parsed.apiSpec?.errorCodes).toEqual(["400", "500"]);
  });

  test("treats '无' as empty error codes", () => {
    const md = [
      "#### 任务内容",
      "",
      "#### 接口协议",
      "- 接口路径：/api/x",
      "- 错误码：无",
      "",
      "#### 子任务",
      "",
      "#### 验收标准（DoD）",
    ].join("\n");
    const parsed = parseTaskMarkdownDraft(md);
    expect(parsed.apiSpec?.errorCodes).toEqual([]);
  });

  test("falls back to POST when method is unknown", () => {
    const md = [
      "#### 任务内容",
      "",
      "#### 接口协议",
      "- 接口路径：/api/x",
      "- 请求方法：HOP",
      "",
      "#### 子任务",
      "",
      "#### 验收标准（DoD）",
    ].join("\n");
    expect(parseTaskMarkdownDraft(md).apiSpec?.method).toBe("POST");
  });

  test("round-trips with taskToMarkdown for a representative task", () => {
    const task: TaskItem = {
      id: "t1",
      title: "示例",
      description: "示例描述",
      role: "fullstack",
      size: "M",
      subtasks: ["子A", "子B"],
      dod: ["验收A"],
      apiSpec: {
        endpoint: "/api/x",
        method: "POST",
        requestSchema: "{}",
        responseSchema: "{}",
        errorCodes: ["400"],
      },
    } as unknown as TaskItem;
    const md = taskToMarkdown(task);
    const parsed = parseTaskMarkdownDraft(md);
    expect(parsed.description).toBe("示例描述");
    expect(parsed.subtasks).toEqual(["子A", "子B"]);
    expect(parsed.dod).toEqual(["验收A"]);
    expect(parsed.apiSpec?.endpoint).toBe("/api/x");
    expect(parsed.apiSpec?.errorCodes).toEqual(["400"]);
  });
});

describe("taskPreviewLine", () => {
  test("strips br tags and collapses whitespace", () => {
    expect(taskPreviewLine("行一<br />行二", "")).toBe("行一 行二");
  });

  test("falls back to second part and default label", () => {
    expect(taskPreviewLine("", "子任务 A")).toBe("子任务 A");
    expect(taskPreviewLine("", "")).toBe("暂无任务内容");
  });
});
