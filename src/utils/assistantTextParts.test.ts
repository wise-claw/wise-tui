import { describe, expect, test } from "bun:test";
import type { MessagePart } from "../types";
import {
  assistantTextJoinedFromParts,
  countAssistantTextParagraphs,
  joinAssistantTextPartBodies,
  shouldStartNewAssistantTextPart,
} from "./assistantTextParts";

describe("joinAssistantTextPartBodies", () => {
  test("joins multiple bodies with paragraph separator", () => {
    expect(joinAssistantTextPartBodies(["第一段", "第二段"])).toBe("第一段\n\n第二段");
  });

  test("trims inter-part whitespace like buildMergedTextGroups", () => {
    expect(joinAssistantTextPartBodies(["intro  ", "\n\n  总结"])).toBe("intro\n\n总结");
  });
});

describe("shouldStartNewAssistantTextPart", () => {
  test("detects explicit paragraph break in incoming", () => {
    expect(shouldStartNewAssistantTextPart("已完成。", "\n\n## 总结")).toBe(true);
  });

  test("detects markdown block after sentence end", () => {
    expect(shouldStartNewAssistantTextPart("工具已执行完毕。", "## 总结")).toBe(true);
    expect(shouldStartNewAssistantTextPart("工具已执行完毕。", "- 改动一")).toBe(true);
  });

  test("allows delta continuation within same block", () => {
    expect(shouldStartNewAssistantTextPart("你好", "世界")).toBe(false);
  });
});

describe("assistantTextJoinedFromParts", () => {
  test("aligns content field with render merge", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "## 总结" },
      { type: "tool_use", id: "t1", name: "Read", input: {}, status: "completed" },
      { type: "text", text: "- 项一\n- 项二" },
    ];
    expect(assistantTextJoinedFromParts(parts)).toBe("## 总结\n\n- 项一\n- 项二");
  });
});

describe("countAssistantTextParagraphs", () => {
  test("counts split paragraphs", () => {
    expect(countAssistantTextParagraphs("a\n\nb\n\nc")).toBe(3);
  });
});
