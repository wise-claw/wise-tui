import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../../types";
import { shouldRenderOutputAsMarkdown, getToolDisplayInfo } from "./MessageParts";

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
    expect(info.subtitle).toBe("调用 ID t1");
  });
});
