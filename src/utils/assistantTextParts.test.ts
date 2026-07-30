import { describe, expect, test } from "bun:test";
import type { MessagePart } from "../types";
import {
  assistantTextJoinedFromParts,
  countAssistantTextParagraphs,
  isAssistantFullTextSnapshotOfParts,
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

  test("does not cascade paragraph breaks after CJK-to-latin transition", () => {
    expect(
      joinAssistantTextPartBodies([
        "党",
        "费",
        "申",
        "请",
        "源",
        "页",
        "与",
        "目",
        "标",
        "Inc",
        "ubation",
        "Fund",
        "Detail",
      ]),
    ).toBe("党费申请源页与目标 Incubation Fund Detail");
  });

  test("joins longer CJK shards without poisoning later tokens", () => {
    expect(joinAssistantTextPartBodies(["党", "费申请", "源页", "与目标"])).toBe("党费申请源页与目标");
  });

  test("keeps phrase paragraphs separate even when followed by latin shards", () => {
    expect(joinAssistantTextPartBodies(["看一下源页结构", "下一步再改"])).toBe(
      "看一下源页结构\n\n下一步再改",
    );
  });

  test("trims inter-part whitespace like buildMergedTextGroups", () => {
    expect(joinAssistantTextPartBodies(["intro  ", "\n\n  总结"])).toBe("intro\n\n总结");
  });

  test("drops a whole body that repeats what is already accumulated", () => {
    // 上游多条路径（result 全文 / complete 兜底 preview / 内存与磁盘合并）可能把同一段
    // 正文塞进 parts 两次；分段位置不同会让严格相等失配，整段翻倍上屏。
    const streamed = "你好！我是你的 AI 开发助手。\n\n**当前会话状态：**\n- 开发者身份：claude-agent\n- 当前任务：无";
    const authoritative = "你好！我是你的 AI 开发助手。\n\n**当前会话状态：**\n- 开发者身份：claude-agent\n- 当前任务：无";
    expect(joinAssistantTextPartBodies([streamed, authoritative])).toBe(authoritative);
  });

  test("prefers the authoritative body when an earlier split corrupted separators", () => {
    // 分段位置不同（加粗标记被 \n\n 拆断）时忽略空白仍判为同一内容，取后到的规整版本。
    const corrupted = "你好！我是你的 AI 开发助手。\n\n**当前会话状态：\n\n**\n- 开发者身份：claude-agent";
    const clean = "你好！我是你的 AI 开发助手。\n\n**当前会话状态：**\n- 开发者身份：claude-agent";
    expect(joinAssistantTextPartBodies([corrupted, clean])).toBe(clean);
  });

  test("replaces accumulated bodies when a later body is their superset", () => {
    const intro = "先看一下当前仓库的目录结构，确认改动范围落在哪一层，再决定从哪个模块开始动手，避免一次改动牵扯过多文件。";
    const full = `${intro}\n\n随后再补齐对应的回归测试，避免同类问题复发。`;
    expect(joinAssistantTextPartBodies([intro, full])).toBe(full);
  });

  test("keeps repeated bodies shorter than the dedupe threshold", () => {
    // 去重只对成段正文生效：确认语、表格单元等短段允许合法重复，不能被吃掉。
    expect(joinAssistantTextPartBodies(["好的。", "好的。"])).toBe("好的。\n\n好的。");
    const short = "改动已就绪，等你确认。";
    expect(joinAssistantTextPartBodies([short, short])).toBe(`${short}\n\n${short}`);
  });
});

describe("isLikelyStreamTextFragment", () => {
  test("detects latin and CJK stream shards", () => {
    expect(isLikelyStreamTextFragment("Inc", "ubation")).toBe(true);
    expect(isLikelyStreamTextFragment("党", "费")).toBe(true);
    expect(isLikelyStreamTextFragment("党", "费申请")).toBe(true);
  });

  test("detects CJK to latin mid-sentence shards", () => {
    expect(isLikelyStreamTextFragment("目标", "Inc")).toBe(true);
    expect(isLikelyStreamTextFragment("Incubation", "详情")).toBe(false);
  });

  test("keeps phrase paragraphs separate", () => {
    expect(isLikelyStreamTextFragment("intro 段一", "intro 段二")).toBe(false);
  });

  test("ignores whitespace already present earlier in prev when checking boundary", () => {
    // 累积串含空格时仍应按接合处判定（供相邻段比较路径）
    expect(isLikelyStreamTextFragment("看一下 目标", "页")).toBe(true);
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

  test("does not split when the block marker only appears on a later line", () => {
    // 只有 next 的**开头**是块级结构才算新段。曾用 `m` 标志令 `^` 匹配任意行首，
    // 于是「首行是加粗收尾标记、次行才是列表」的 delta 被误拆，
    // 在 `**当前会话状态：` / `**` 之间插入 \n\n，加粗标记断开渲染成裸 `**`。
    expect(
      shouldStartNewAssistantTextPart("**当前会话状态：", "**\n- 开发者身份：claude-agent\n- 当前任务：无"),
    ).toBe(false);
  });

  test("still splits when the incoming body itself starts a markdown block", () => {
    expect(shouldStartNewAssistantTextPart("工具已执行完毕：", "- 改动一\n- 改动二")).toBe(true);
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

describe("isAssistantFullTextSnapshotOfParts", () => {
  const intro = "你好。\n\n";
  const body = "我是 Wise 工作区里的 Cursor Agent，可以直接读写文件、跑 shell、改代码。你想先聊什么，或者要我从哪一块开始动手？";
  const fullTurn = `${intro.trim()}\n\n${body}`;

  test("detects a full-turn snapshot that repeats accumulated text parts", () => {
    const parts: MessagePart[] = [
      { type: "text", text: intro },
      { type: "text", text: body },
    ];
    expect(isAssistantFullTextSnapshotOfParts(parts, fullTurn)).toBe(true);
  });

  test("sees through separator differences between snapshot and accumulated parts", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "你好。" },
      { type: "text", text: body },
    ];
    expect(isAssistantFullTextSnapshotOfParts(parts, `你好。\n${body}`)).toBe(true);
  });

  test("spans text parts separated by a tool call", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "先看一下仓库结构，确认改动落在哪一层，再决定从哪个模块开始动手。" },
      { type: "tool_use", id: "t1", name: "Read", input: {}, status: "completed" },
      { type: "text", text: "结构确认完毕，改动集中在流式装配层，我先补上对应的回归测试。" },
    ];
    const snapshot =
      "先看一下仓库结构，确认改动落在哪一层，再决定从哪个模块开始动手。\n\n结构确认完毕，改动集中在流式装配层，我先补上对应的回归测试。";
    expect(isAssistantFullTextSnapshotOfParts(parts, snapshot)).toBe(true);
  });

  test("rejects normal delta increments", () => {
    const parts: MessagePart[] = [{ type: "text", text: `${intro}${body}` }];
    expect(isAssistantFullTextSnapshotOfParts(parts, "还有一点要补充。")).toBe(false);
  });

  test("rejects short bodies so legitimate repeats survive", () => {
    const parts: MessagePart[] = [{ type: "text", text: "好的。" }];
    expect(isAssistantFullTextSnapshotOfParts(parts, "好的。")).toBe(false);
  });

  test("rejects a snapshot that diverges from accumulated text", () => {
    const parts: MessagePart[] = [{ type: "text", text: body }];
    expect(
      isAssistantFullTextSnapshotOfParts(parts, "换个说法：我可以帮你读写文件、跑 shell、改代码，你说要做什么就行。"),
    ).toBe(false);
  });
});

describe("countAssistantTextParagraphs", () => {
  test("counts split paragraphs", () => {
    expect(countAssistantTextParagraphs("a\n\nb\n\nc")).toBe(3);
  });
});
