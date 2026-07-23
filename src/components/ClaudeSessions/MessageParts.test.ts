import { describe, expect, test } from "bun:test";
import type { MessagePart, TextPart, ToolUsePart, ReasoningPart } from "../../types";
import {
  shouldRenderOutputAsMarkdown,
  getToolDisplayInfo,
  shouldShowToolOutputBody,
  getToolInputParamRows,
  parseMcpToolName,
  buildMergedTextGroups,
} from "./MessageParts";
import { isRenderableMessagePart } from "../../utils/claudeChatMessageDisplay";

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

describe("buildMergedTextGroups", () => {
  function text(t: string): TextPart {
    return { type: "text", text: t };
  }
  function reason(t: string): ReasoningPart {
    return { type: "reasoning", text: t };
  }
  function bashTool(id: string): ToolUsePart {
    return {
      type: "tool_use",
      id,
      name: "bash",
      input: { command: "ls" },
      output: "ok",
      status: "completed",
    };
  }

  test("keeps single text part as is (no merge)", () => {
    const visible: MessagePart[] = [text("单独一段")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("single");
    if (groups[0]!.type === "single") {
      expect(groups[0]!.originalIndex).toBe(0);
    }
  });

  test("merges adjacent text parts with \\n\\n separator", () => {
    // 实时流式多 block（typical [intro text, tool_use, summary text] 在工具前为单 part、工具后单 part）
    // 与磁盘回放的多 part 形态一致：合并为一段 + 段间分隔。
    const visible: MessagePart[] = [text("intro 段一"), text("intro 段二")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("intro 段一\n\nintro 段二");
      expect(groups[0]!.firstOriginalIndex).toBe(0);
      expect(groups[0]!.lastOriginalIndex).toBe(1);
    }
  });

  test("does not split merged_text across tool_use boundary", () => {
    // 关键回归：[intro text, tool_use, summary text] 三段 -> 3 组（不是 2 组）
    const visible: MessagePart[] = [
      text("intro"),
      bashTool("t1"),
      text("summary"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual([
      "single",
      "tool_group",
      "single",
    ]);
    expect(groups[0]!.type).toBe("single");
    if (groups[0]!.type === "single") {
      expect(groups[0]!.originalIndex).toBe(0);
    }
    expect(groups[1]!.type).toBe("tool_group");
    if (groups[1]!.type === "tool_group") {
      expect(groups[1]!.parts).toHaveLength(1);
      expect(groups[1]!.parts[0]!.originalIndex).toBe(1);
    }
    expect(groups[2]!.type).toBe("single");
    if (groups[2]!.type === "single") {
      expect(groups[2]!.originalIndex).toBe(2);
    }
  });

  test("merges multiple consecutive tool_use parts into one tool_group", () => {
    const visible: MessagePart[] = [
      bashTool("t1"),
      bashTool("t2"),
      bashTool("t3"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("tool_group");
    if (groups[0]!.type === "tool_group") {
      expect(groups[0]!.parts.map((p) => p.part.id)).toEqual(["t1", "t2", "t3"]);
      expect(groups[0]!.parts.map((p) => p.originalIndex)).toEqual([0, 1, 2]);
    }
  });

  test("does not merge reasoning with text (special-cases reasoning parts)", () => {
    // reasoning 有专门折叠样式，不能与 text 混渲 -> 拆 reasoning 为单独段
    const visible: MessagePart[] = [
      text("前"),
      reason("思考中"),
      text("后"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual(["single", "single", "single"]);
    expect(groups[0]!.type).toBe("single");
    expect(groups[2]!.type).toBe("single");
    if (groups[0]!.type === "single") {
      expect(groups[0]!.originalIndex).toBe(0);
    }
    if (groups[2]!.type === "single") {
      expect(groups[2]!.originalIndex).toBe(2);
    }
  });

  test("merges two consecutive text parts split only by a blank-only text part into one segment", () => {
    // 实际场景：含空白 text part 应被 trim 后过滤，因此不阻断合并
    const visible: MessagePart[] = [
      text("第一段"),
      text("   "),
      text("第二段"),
    ];
    const groups = buildMergedTextGroups(visible);
    // 空白段被过滤；剩两条 text 合并
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("第一段\n\n第二段");
      // 因空白 part 被剔除，lastOriginalIndex 是原 parts 末条索引（2）
      expect(groups[0]!.lastOriginalIndex).toBe(2);
    }
  });

  test("strips leading whitespace of subsequent text parts before joining", () => {
    // 模型产物偶尔会以换行开始（如 \n\n 开头），合并时不应让前段尾随空白 + 后段前导空白形成四换行
    const visible: MessagePart[] = [text("intro  "), text("\n\n 总结")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      // 首段 trimEnd 去尾随空白；后段 trim 去前导空白；拼接为单一 \n\n
      expect(groups[0]!.joinedText).toBe("intro\n\n总结");
    }
  });

  test("filters out trailing whitespace-only merged segments (no empty card)", () => {
    // 全 trim 空段：例如流式中段 text part 整体为空，不应渲染一个空 markdown card
    const visible: MessagePart[] = [text("   ")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(0);
  });

  test("preserves tool_group ordering with merged_text run around it", () => {
    // 用带空格的短语作段，避免被 isLikelyStreamTextFragment 当成拉丁 BPE 碎片无分隔拼接
    const visible: MessagePart[] = [
      text("pre one"),
      text("pre two"),
      bashTool("t1"),
      text("post one"),
      text("post two"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual([
      "merged_text",
      "tool_group",
      "merged_text",
    ]);
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("pre one\n\npre two");
    }
    if (groups[2]!.type === "merged_text") {
      expect(groups[2]!.joinedText).toBe("post one\n\npost two");
    }
  });

  test("does not merge reasoning even when sandwiched between text runs", () => {
    // text + reasoning + text 必须是 3 段，不允许 reasoning 与两侧 text 合并
    const visible: MessagePart[] = [
      text("head"),
      reason("thinking"),
      text("tail"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual(["single", "single", "single"]);
    if (groups[0]!.type === "single") {
      expect((groups[0]!.part as TextPart).text).toBe("head");
    }
    if (groups[1]!.type === "single") {
      expect((groups[1]!.part as ReasoningPart).text).toBe("thinking");
    }
    if (groups[2]!.type === "single") {
      expect((groups[2]!.part as TextPart).text).toBe("tail");
    }
  });

  test("returns empty array for empty input (caller renders null)", () => {
    expect(buildMergedTextGroups([])).toEqual([]);
  });

  test("single text part stays as single, not merged_text (TextPartDisplay path)", () => {
    // 单 part 永远走 single 分支——merged_text 强制要求多 part；确保 chat-prose
    // 仍然按单 part 的 text 触发，不被合并逻辑吃掉。
    const visible: MessagePart[] = [text("只有一段文字")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("single");
    if (groups[0]!.type === "single") {
      expect(groups[0]!.originalIndex).toBe(0);
      expect((groups[0]!.part as TextPart).text).toBe("只有一段文字");
    }
  });

  test("single text part preserves originalIndex even when part text has trailing whitespace", () => {
    // 单 part 走 trimmed text，但 type 仍是 single（避免误合并路径）
    const visible: MessagePart[] = [text("  内容  ")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("single");
    if (groups[0]!.type === "single") {
      expect(groups[0]!.originalIndex).toBe(0);
    }
  });

  test("text + reasoning + 2 text parts: reasoning 隔断两侧合并为独立 merged_text", () => {
    // [t1, reasoning, t2, t3] -> [single(t1), single(reasoning), merged_text(t2,t3)]
    // 关键是 reasoning 不与 text 合并，但 reasoning 之后的 t2 + t3 仍合并。
    const visible: MessagePart[] = [
      text("前置段"),
      reason("思考中"),
      text("后置一段"),
      text("后置二段"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual(["single", "single", "merged_text"]);
    if (groups[2]!.type === "merged_text") {
      expect(groups[2]!.joinedText).toBe("后置一段\n\n后置二段");
      expect(groups[2]!.firstOriginalIndex).toBe(2);
      expect(groups[2]!.lastOriginalIndex).toBe(3);
    }
  });

  test("two text parts + reasoning + single trailing text: 4 groups, no cross-reason merging", () => {
    // [t1, t2, reasoning, t3] -> [merged_text(t1,t2), single(reasoning), single(t3)]
    const visible: MessagePart[] = [
      text("第一段"),
      text("第二段"),
      reason("思考"),
      text("末尾段"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.type)).toEqual(["merged_text", "single", "single"]);
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("第一段\n\n第二段");
      expect(groups[0]!.firstOriginalIndex).toBe(0);
      expect(groups[0]!.lastOriginalIndex).toBe(1);
    }
  });

  test("merges 5 consecutive text parts and preserves first/last originalIndex across trimmed empties", () => {
    // 长 run 边界：5 个 text part + 中间夹杂空白段，验证 firstOriginalIndex / lastOriginalIndex 跨剔除空段正确。
    // 单汉字相邻会被识别为流式碎片并无分隔拼接（避免一词一行竖排）。
    const visible: MessagePart[] = [
      text("一"),
      text("  "),
      text("二"),
      text("三"),
      text("   "),
      text("四"),
      text("五"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("一二三四五");
      expect(groups[0]!.firstOriginalIndex).toBe(0);
      expect(groups[0]!.lastOriginalIndex).toBe(6);
    }
  });

  test("trailing reasoning after merged text: reasoning 不合并，单独一段", () => {
    // [t1, t2, reasoning] -> [merged_text(t1,t2), single(reasoning)]
    const visible: MessagePart[] = [
      text("第一段"),
      text("第二段"),
      reason("尾部思考"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.type)).toEqual(["merged_text", "single"]);
    if (groups[1]!.type === "single") {
      expect((groups[1]!.part as ReasoningPart).text).toBe("尾部思考");
      expect(groups[1]!.originalIndex).toBe(2);
    }
  });

  test("all parts filtered to whitespace-only text returns empty array (no empty card)", () => {
    // 全空 parts（实际很少见，但 buildMergedTextGroups 应鲁棒）
    const visible: MessagePart[] = [text(""), text("   "), text("\n\n")];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toEqual([]);
  });

  test("three text parts where middle is whitespace-only get merged with trimmed middle dropped", () => {
    // [t1, whitespace, t2] -> 1 个 merged_text (t1 + t2)，lastOriginalIndex 是 t2 的原始索引。
    // 单字母 a/b 会被当成拉丁碎片拼接；这里用带空格短语验证段间仍走 \n\n。
    const visible: MessagePart[] = [
      text("alpha 段"),
      text("   \n\n  "),
      text("beta 段"),
    ];
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("alpha 段\n\nbeta 段");
      expect(groups[0]!.firstOriginalIndex).toBe(0);
      expect(groups[0]!.lastOriginalIndex).toBe(2);
    }
  });
});

describe("buildMergedTextGroups with isRenderableMessagePart filter", () => {
  test("after filtering invisible tool_use names (e.g. AskUserQuestion), merges adjacent text parts", () => {
    // AskUserQuestion tool_use 被 isRenderableMessagePart 过滤（`claudeChatMessageDisplay.ts` 的工具分支），
    // 视图中只剩前后两条 text part -> 合并为单段；避免 dock + list 双卡片。
    const text1: TextPart = { type: "text", text: "分析步骤" };
    const invisibleTool: ToolUsePart = {
      type: "tool_use",
      id: "ask1",
      name: "AskUserQuestion",
      input: { question: "选哪个？" },
      status: "completed",
    };
    const text2: TextPart = { type: "text", text: "我的回答" };
    const parts: MessagePart[] = [text1, invisibleTool, text2];
    const visible = parts.filter(isRenderableMessagePart);
    // sanity: invisibleTool 应当被过滤掉
    expect(visible).toHaveLength(2);
    const groups = buildMergedTextGroups(visible);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("merged_text");
    if (groups[0]!.type === "merged_text") {
      expect(groups[0]!.joinedText).toBe("分析步骤\n\n我的回答");
    }
  });
});
