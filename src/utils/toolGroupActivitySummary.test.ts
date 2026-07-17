import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../types";
import { buildToolGroupActivitySummary } from "./toolGroupActivitySummary";

function tool(
  name: string,
  input: Record<string, unknown> = {},
  status: ToolUsePart["status"] = "completed",
): ToolUsePart {
  return {
    type: "tool_use",
    id: `id-${name}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    input,
    status,
  };
}

describe("buildToolGroupActivitySummary", () => {
  test("summarizes explore + search + tools + command like Cursor", () => {
    const summary = buildToolGroupActivitySummary([
      tool("Read", { file_path: "/repo/.agents/skills/foo/SKILL.md" }),
      tool("Grep", { pattern: "GlobalComposer" }),
      tool("Grep", { pattern: "常用语" }),
      tool("mcp__codegraph__codegraph_explore", { query: "phrases" }),
      tool("Task", { description: "explore" }),
      tool("Bash", { command: "ls" }),
    ]);
    expect(summary.label).toContain("探索了 SKILL.md");
    expect(summary.label).toContain("2 次搜索");
    expect(summary.label).toContain("2 个工具");
    expect(summary.label).toContain("执行 1 条命令");
    expect(summary.running).toBe(false);
  });

  test("summarizes edits with line counts", () => {
    const summary = buildToolGroupActivitySummary([
      tool("Edit", {
        file_path: "/repo/a.tsx",
        old_string: "a\nb\n",
        new_string: "a\nb\nc\nd\n",
      }),
      tool("Edit", {
        file_path: "/repo/b.tsx",
        old_string: "x\ny\nz\n",
        new_string: "x\n",
      }),
      tool("Read", { file_path: "/repo/c.ts" }),
      tool("Read", { file_path: "/repo/d.ts" }),
    ]);
    expect(summary.label).toContain("编辑了 2 个文件");
    expect(summary.label).toContain("探索了 2 个文件");
    expect(summary.addedLines).toBeGreaterThan(0);
    expect(summary.removedLines).toBeGreaterThan(0);
  });

  test("marks running groups with ellipsis", () => {
    const summary = buildToolGroupActivitySummary([
      tool("Read", { file_path: "/repo/a.ts" }, "running"),
    ]);
    expect(summary.running).toBe(true);
    expect(summary.label.endsWith("…")).toBe(true);
  });
});
