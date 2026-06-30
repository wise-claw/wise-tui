import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../../types";
import {
  shouldRenderOutputAsMarkdown,
  getToolDisplayInfo,
  shouldShowToolOutputBody,
  getToolInputParamRows,
  parseMcpToolName,
} from "./MessageParts";

describe("shouldRenderOutputAsMarkdown", () => {
  const buildPart = (name: string, output: string): ToolUsePart => ({
    id: "tool-id",
    type: "tool_use",
    name,
    input: {},
    output,
    status: "completed",
  });

  test("always renders generic fallback and subagent/task as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("", "Some text"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("task", "Some text"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("subagent", "Some text"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("Agent", "Some text"))).toBe(true);
  });

  test("never renders code/CLI/filesystem tools as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("bash", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("exec", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("read_file", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("view_file", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("grep", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("grep_search", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("glob", "## Heading\n- List"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("list_dir", "## Heading\n- List"))).toBe(false);
  });

  test("renders completion summary markdown even for edit tool output", () => {
    const summary = "已完成！以下是改动总结：\n\n---\n\n## 大屏视频播放功能 — 改动总结\n| 文件 | 变更 |";
    expect(shouldRenderOutputAsMarkdown(buildPart("edit", summary))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("TaskUpdate", summary))).toBe(true);
  });

  test("renders bash completion summary markdown instead of monospace pre", () => {
    const summary =
      "零错误。全部改动已就绪，以下是总结：\n\n---\n\n## ✅ 大屏视频播放功能 — 完成\n| 文件 | 变更 |";
    expect(shouldRenderOutputAsMarkdown(buildPart("bash", summary))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("exec", summary))).toBe(true);
  });

  test("detects headings and bullet lists correctly as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("search_web", "## Search Results\nHere is what I found"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "Here is a list:\n- item 1\n- item 2"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "Here is a list:\n* item 1\n* item 2"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "This is **bold** text"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "This is inline `code` block"))).toBe(true);
  });

  test("detects markdown tables correctly", () => {
    const tableText = "Here is a table:\n| col1 | col2 |\n|---|---|\n| a | b |";
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", tableText))).toBe(true);
  });

  test("returns false for plain text with no markdown cues", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "Just standard plain text without any markdown elements."))).toBe(false);
  });

  test("REGRESSION: snake_case / file_path identifiers do NOT trigger markdown (bare underscore)", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "set foo_bar and base_url then run"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "wrote src/utils/my_helper.ts and MY_ENV_VAR=1"))).toBe(false);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "a_b c_d e_f g_h plain output"))).toBe(false);
  });

  test("still detects genuine _emphasis_ underscores as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "this is _emphasized_ text"))).toBe(true);
  });

  test("still detects __bold__ double-underscore as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "status: __FAILED__ now"))).toBe(true);
  });

  test("still detects standalone fenced code blocks as markdown", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "```json\n{\"a\":1}\n```"))).toBe(true);
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "```python\nprint(\"hi\")\n```"))).toBe(true);
  });

  test("identifier with internal double underscore stays plain (no false positive)", () => {
    expect(shouldRenderOutputAsMarkdown(buildPart("custom_workflow", "called foo__bar and a__b plain"))).toBe(false);
  });

  test("always renders Skill tool output as markdown", () => {
    const part: ToolUsePart = {
      id: "s1",
      type: "tool_use",
      name: "Skill",
      input: { skill: "demo" },
      output: "Plain skill body without markdown cues.",
      status: "completed",
    };
    expect(shouldRenderOutputAsMarkdown(part)).toBe(true);
  });
});

describe("shouldShowToolOutputBody", () => {
  test("hides output when it duplicates tool error text", () => {
    const part: ToolUsePart = {
      id: "t1",
      type: "tool_use",
      name: "",
      input: {},
      status: "error",
      error: "File does not exist.",
      output: "File does not exist.",
    };
    expect(shouldShowToolOutputBody(part)).toBe(false);
  });

  test("shows output when error text differs", () => {
    const part: ToolUsePart = {
      id: "t1",
      type: "tool_use",
      name: "bash",
      input: {},
      status: "error",
      error: "Command failed",
      output: "stderr details",
    };
    expect(shouldShowToolOutputBody(part)).toBe(true);
  });
});

describe("getToolDisplayInfo skill", () => {
  test("uses skill name in subtitle without dumping output", () => {
    const part: ToolUsePart = {
      id: "s1",
      type: "tool_use",
      name: "Skill",
      input: { skill: "trellis-before-dev" },
      output: "# Skill\n\nLong markdown body…",
      status: "completed",
    };
    const info = getToolDisplayInfo(part);
    expect(info.label).toBe("Skill");
    expect(info.subtitle).toBe("trellis-before-dev");
  });
});

describe("parseMcpToolName", () => {
  test("splits mcp__server__tool into humanized server / tool", () => {
    expect(parseMcpToolName("mcp__chrome__chrome_navigate")).toEqual({
      server: "chrome",
      tool: "chrome navigate",
    });
    expect(parseMcpToolName("mcp__ida-pro-mcp__open_file")).toEqual({
      server: "ida-pro-mcp",
      tool: "open file",
    });
  });

  test("returns null for non-mcp names", () => {
    expect(parseMcpToolName("bash")).toBeNull();
    expect(parseMcpToolName("Read")).toBeNull();
  });
});

describe("getToolDisplayInfo MCP + unknown", () => {
  const build = (name: string, input: Record<string, unknown> = {}): ToolUsePart => ({
    id: "t",
    type: "tool_use",
    name,
    input,
    status: "completed",
  });

  test("prettifies MCP tool label and surfaces server in subtitle", () => {
    const info = getToolDisplayInfo(build("mcp__chrome__chrome_navigate", { url: "https://x" }));
    expect(info.label).toBe("chrome navigate");
    expect(info.subtitle).toContain("chrome");
    expect(info.subtitle).toContain("https://x");
  });

  test("treats placeholder 'unknown' name as empty result card", () => {
    const info = getToolDisplayInfo({
      id: "t",
      type: "tool_use",
      name: "unknown",
      input: {},
      output: "some result text",
      status: "completed",
    });
    expect(info.label).toBe("工具结果");
  });
});

describe("getToolInputParamRows", () => {
  test("returns non-empty key/value rows and skips blanks", () => {
    const rows = getToolInputParamRows({
      id: "t",
      type: "tool_use",
      name: "grep",
      input: { pattern: "foo", path: "/x", empty: "", missing: null, nested: { a: 1 } },
      status: "completed",
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("pattern");
    expect(keys).toContain("path");
    expect(keys).not.toContain("empty");
    expect(keys).not.toContain("missing");
    const nested = rows.find((r) => r.key === "nested");
    expect(nested?.value).toContain("\"a\": 1");
  });

  test("returns empty array when there is no object input", () => {
    expect(
      getToolInputParamRows({
        id: "t",
        type: "tool_use",
        name: "bash",
        input: undefined as unknown as Record<string, unknown>,
        status: "completed",
      }),
    ).toEqual([]);
  });
});

describe("getToolDisplayInfo fallback", () => {
  test("returns correct generic fallback title", () => {
    const part: ToolUsePart = {
      id: "t1",
      type: "tool_use",
      name: "",
      input: {},
      output: "Done",
      status: "completed",
    };
    const info = getToolDisplayInfo(part);
    expect(info.label).toBe("工具结果");
    expect(info.subtitle).toBe("Done");
  });
});
