import { describe, expect, test } from "bun:test";
import type { MessagePart } from "../types";
import {
  assistantTextJoinedFromParts,
  countAssistantTextParagraphs,
  isLikelyStreamTextFragment,
  joinAssistantTextPartBodies,
  shouldStartNewAssistantTextPart,
} from "./assistantTextParts";

describe("joinAssistantTextPartBodies", () => {
  test("joins phrase-like bodies with paragraph separator", () => {
    expect(joinAssistantTextPartBodies(["intro 段一", "intro 段二"])).toBe("intro 段一\n\nintro 段二");
  });

  test("concatenates stream token fragments instead of stacking lines", () => {
    expect(joinAssistantTextPartBodies(["Inc", "ubation"])).toBe("Incubation");
    expect(joinAssistantTextPartBodies(["党", "费", "申", "请"])).toBe("党费申请");
  });

  test("trims inter-part whitespace like buildMergedTextGroups", () => {
    expect(joinAssistantTextPartBodies(["intro  ", "\n\n  总结"])).toBe("intro\n\n总结");
  });
});

describe("isLikelyStreamTextFragment", () => {
  test("detects latin and CJK stream shards", () => {
    expect(isLikelyStreamTextFragment("Inc", "ubation")).toBe(true);
    expect(isLikelyStreamTextFragment("党", "费")).toBe(true);
  });

  test("keeps phrase paragraphs separate", () => {
    expect(isLikelyStreamTextFragment("intro 段一", "intro 段二")).toBe(false);
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
