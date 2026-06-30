import { describe, expect, test } from "bun:test";
import {
  advanceBaselineIfExtendedByRaw,
  advanceComposerSpeechTranscriptBaseline,
  applyComposerSpeechStreamTranscript,
  appendSpeechBaselineSegment,
  commitComposerSpeechTranscriptBaselineForSend,
  createComposerSpeechStreamAnchor,
  extractComposerSpeechTranscriptDelta,
  normalizeSpeechPlainForCompare,
  pickLongerSpeechBaseline,
  reconcileComposerSpeechStreamAnchor,
  resolveComposerSpeechDisplayText,
  resolveComposerSpeechTranscriptDelta,
  stripClearedRawPrefix,
  stripComposerSpeechDeltaOverlap,
} from "./composerSpeechStreaming";

describe("composerSpeechStreaming", () => {
  test("partial updates replace utterance in place", () => {
    const anchor = createComposerSpeechStreamAnchor("hello ", 6);
    const partial = applyComposerSpeechStreamTranscript(anchor, "你", false);
    expect(partial.plain).toBe("hello 你");
    expect(partial.cursor).toBe(7);

    const partial2 = applyComposerSpeechStreamTranscript(partial.anchor, "你好", false);
    expect(partial2.plain).toBe("hello 你好");
  });

  test("final commits prefix for next utterance", () => {
    const anchor = createComposerSpeechStreamAnchor("hi ", 3);
    const final = applyComposerSpeechStreamTranscript(anchor, "世界", true);
    expect(final.plain).toBe("hi 世界");
    expect(final.anchor.prefix).toBe("hi 世界");
    expect(final.cursor).toBe(final.anchor.prefix.length);
  });

  test("reconcile drops stale anchor after composer cleared on send", () => {
    const stale = createComposerSpeechStreamAnchor("已发送的内容", 6);
    expect(reconcileComposerSpeechStreamAnchor(stale, "", 0)).toEqual({
      prefix: "",
      suffix: "",
    });
  });

  test("extract delta after send baseline in continuous session", () => {
    const baseline = "你好，我是谁";
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好，我是谁")).toBe("");
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好，我是谁不要发送后的消息")).toBe(
      "不要发送后的消息",
    );
    expect(extractComposerSpeechTranscriptDelta(baseline, "不要发送后的消息")).toBe(
      "不要发送后的消息",
    );
  });

  test("extract delta ignores punctuation drift between baseline and raw", () => {
    const baseline = "你好，我是谁";
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好我是谁不要发送")).toBe("不要发送");
  });

  test("extract delta when baseline is embedded in cumulative raw", () => {
    const baseline = "还有宝可梦和神奇宝贝";
    const raw = "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝。神奇宝贝，这些卡片能做什么";
    expect(extractComposerSpeechTranscriptDelta(baseline, raw)).toBe("神奇宝贝，这些卡片能做什么");
  });

  test("advance baseline appends sentPlain instead of replacing cumulative baseline", () => {
    const baseline = "我有很多卡片。奥特曼卡片";
    const sent = "还有宝可梦和神奇宝贝";
    expect(advanceComposerSpeechTranscriptBaseline(baseline, "", sent)).toBe(
      "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝",
    );
  });

  test("commit baseline keeps cumulative history when lastRaw is only current phrase", () => {
    expect(
      commitComposerSpeechTranscriptBaselineForSend(
        "我有很多卡片。奥特曼卡片",
        "还有宝可梦和神奇宝贝",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝");
  });

  test("strip delta overlap removes repeated last sent plain", () => {
    expect(
      stripComposerSpeechDeltaOverlap(
        "神奇宝贝，还有宝可梦和神奇宝贝，这些卡片能做什么",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("神奇宝贝，这些卡片能做什么");
  });

  test("pickLongerSpeechBaseline prefers cumulative over short raw", () => {
    expect(
      pickLongerSpeechBaseline(
        "我有很多卡片。奥特曼卡片",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("我有很多卡片。奥特曼卡片");
  });

  test("appendSpeechBaselineSegment prefers longer raw hint", () => {
    const merged = appendSpeechBaselineSegment(
      "我有很多卡片。奥特曼卡片",
      "还有宝可梦和神奇宝贝",
      "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝",
    );
    expect(merged).toBe("我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝");
  });

  test("resolve display text replaces composer with delta only", () => {
    expect(resolveComposerSpeechDisplayText("第二句")).toEqual({ plain: "第二句", cursor: 3 });
  });

  test("strip delta overlap removes prefix duplicate from previous auto-send", () => {
    expect(
      stripComposerSpeechDeltaOverlap(
        "载一首歌，我要出发了，我出发了",
        "载一首歌，我要出发了。",
      ),
    ).toBe("我出发了");
  });

  test("extract delta after auto-send with punctuation drift", () => {
    const baseline = commitComposerSpeechTranscriptBaselineForSend(
      "",
      "载一首歌，我要出发了",
      "载一首歌，我要出发了。",
    );
    const delta = extractComposerSpeechTranscriptDelta(baseline, "载一首歌，我要出发了，我出发了");
    expect(resolveComposerSpeechDisplayText(delta).plain).toBe("我出发了");
  });

  test("resolveComposerSpeechTranscriptDelta uses raw text for sensevoice without baseline", () => {
    expect(
      resolveComposerSpeechTranscriptDelta({
        engine: "sensevoice",
        baseline: "",
        rawTranscript: "  你好世界  ",
        lastSentPlain: "",
      }),
    ).toBe("你好世界");
  });

  test("resolveComposerSpeechTranscriptDelta strips lastSentPlain for sensevoice", () => {
    expect(
      resolveComposerSpeechTranscriptDelta({
        engine: "sensevoice",
        baseline: "",
        rawTranscript: "今天干什么",
        lastSentPlain: "今天干什么",
      }),
    ).toBe("");
  });

  test("resolveComposerSpeechTranscriptDelta keeps overlap stripping for web", () => {
    expect(
      resolveComposerSpeechTranscriptDelta({
        engine: "web",
        baseline: "",
        rawTranscript: "已发送内容新的句子",
        lastSentPlain: "已发送内容",
      }),
    ).toBe("新的句子");
  });

  test("stripClearedRawPrefix removes cleared prefix when raw extends cleared", () => {
    expect(stripClearedRawPrefix("已清除的内容后面继续说", "已清除的内容")).toBe(
      "后面继续说",
    );
  });

  test("stripClearedRawPrefix returns raw trimmed when no prefix match", () => {
    expect(stripClearedRawPrefix("全新的一段话", "已清除的内容")).toBe("全新的一段话");
  });

  test("stripClearedRawPrefix returns empty when raw equals cleared compare-noise stripped", () => {
    expect(stripClearedRawPrefix("已清除的内容", "已清除的内容")).toBe("");
    expect(stripClearedRawPrefix("已清除的内容。", "已清除的内容")).toBe("");
  });

  test("advanceBaselineIfExtendedByRaw extends baseline when raw is longer extension", () => {
    expect(advanceBaselineIfExtendedByRaw("你好", "你好世界")).toBe("你好世界");
    expect(advanceBaselineIfExtendedByRaw("你好", "你好，世界")).toBe("你好，世界");
  });

  test("advanceBaselineIfExtendedByRaw keeps baseline when raw is shorter or equal", () => {
    expect(advanceBaselineIfExtendedByRaw("你好世界", "你好")).toBe("你好世界");
    expect(advanceBaselineIfExtendedByRaw("你好", "你好")).toBe("你好");
    expect(advanceBaselineIfExtendedByRaw("你好", "")).toBe("你好");
  });

  test("normalizeSpeechPlainForCompare strips filler punctuation consistently", () => {
    expect(normalizeSpeechPlainForCompare("你好，世界。")).toBe("你好世界");
    expect(normalizeSpeechPlainForCompare("  你好  世界  ")).toBe("你好世界");
    expect(normalizeSpeechPlainForCompare("")).toBe("");
  });

  // ---------------- 端到端：四条根因的纯函数契约（hook 行为）----------------

  test("根因 #2: clear snapshot 后 stripClearedRawPrefix 防幽灵触发", () => {
    // 模拟 executeVoiceClearComposer 时 lastRaw="已清空段"，
    // 下一帧 ASR 仍推 cumulative "已清空段新内容"——hook 应先剥离前缀。
    const cleared = "已清空段";
    const raw = "已清空段新内容";
    const stripped = stripClearedRawPrefix(raw, cleared);
    expect(stripped).toBe("新内容");
  });

  test("根因 #2: clear 后再发的 clear 命令仍能命中（剥后等于命令）", () => {
    const cleared = "已清空段";
    const raw = "已清空段清除";
    const stripped = stripClearedRawPrefix(raw, cleared);
    expect(stripped).toBe("清除");
  });

  test("根因 #3: auto-send 后 advanceBaselineIfExtendedByRaw 推进 baseline", () => {
    // 模拟 silent auto-send 触发瞬间：commit baseline 后，ASR 停顿期把更多尾部推过来。
    const baselineAfterCommit = "今天干什么";
    const lastRaw = "今天干什么 接下来怎么走";
    expect(advanceBaselineIfExtendedByRaw(baselineAfterCommit, lastRaw)).toBe(
      "今天干什么 接下来怎么走",
    );
  });

  test("根因 #3: 非扩展场景 advanceBaselineIfExtendedByRaw 不动 baseline", () => {
    // 正常情况下 lastRaw 是 baseline 子串/已发送片段，不应推进。
    expect(advanceBaselineIfExtendedByRaw("今天干什么", "今天干什么")).toBe("今天干什么");
    expect(advanceBaselineIfExtendedByRaw("今天干什么", "今天")).toBe("今天干什么");
  });

  test("根因 #3: commit + advance 配合：commit 把已发送段落推进，advance 把 ASR 停顿尾部推进", () => {
    const committed = commitComposerSpeechTranscriptBaselineForSend(
      "",
      "今天干什么",
      "今天干什么",
    );
    const advanced = advanceBaselineIfExtendedByRaw(committed, "今天干什么 接下来怎么走");
    expect(advanced).toBe("今天干什么 接下来怎么走");
  });

  // ---------------- Bug B 回归：silent auto-send 后 lastSentPlain 同步写 ----------------
  //
  // 历史上 triggerComposerSpeechAutoSend 走完 prepare + onAutoSend 后**没有**
  // 写回 speechLastSentPlainRef，下一帧 ASR partial 进入 pipeline 时
  // lastSentPlain 为空，stripComposerSpeechDeltaOverlap 不会剥掉已发送段，
  // 已发送内容被重新带回输入框（「发送后再说话把历史带进来」根因）。
  //
  // 修法：在 trigger 末尾同步写 `speechLastSentPlainRef.current = plain`。
  // 本组单测覆盖端到端行为契约：silent auto-send 后下个 ASR frame 进入
  // pipeline，期望 delta 已剥掉已发送 plain。

  test("Bug B: silent auto-send 后下个 ASR partial 的 delta 已剥掉已发送段", () => {
    // 模拟：用户说"今天干什么"，silence auto-send 触发，发"今天干什么"。
    // 紧接着 ASR 推 partial "今天干什么接下来怎么走"（cumulative 仍含已发送段）。
    // hook 内 baseline 推进到 "今天干什么"，lastSentPlain = "今天干什么"。
    // 进入 processComposerSpeechTranscriptUpdate，extract delta + strip overlap，
    // 期望 delta 仅为 "接下来怎么走"。
    const baseline = commitComposerSpeechTranscriptBaselineForSend(
      "",
      "今天干什么",
      "今天干什么",
    );
    expect(baseline).toBe("今天干什么");

    const lastSentPlain = "今天干什么";
    const nextRaw = "今天干什么接下来怎么走";

    // baseline 推进后 delta 是 "接下来怎么走"（stripped）
    const deltaFromBaseline = extractComposerSpeechTranscriptDelta(baseline, nextRaw);
    expect(deltaFromBaseline).toBe("接下来怎么走");

    // lastSentPlain 也正确剥掉重叠
    const stripped = stripComposerSpeechDeltaOverlap(deltaFromBaseline, lastSentPlain);
    expect(stripped).toBe("接下来怎么走");
  });

  test("Bug B: silent auto-send 后 ASR 推纯增量时，delta = 新内容（不被剥空）", () => {
    // 模拟：用户说"今天干什么"，发送后继续说完全独立的新内容 "明天休息"。
    // hook 内 baseline = "今天干什么"，lastSentPlain = "今天干什么"。
    // ASR 推 raw = "今天干什么明天休息"（cumulative）。
    // 期望 delta = "明天休息"，不被 lastSentPlain 误剥。
    const baseline = "今天干什么";
    const lastSentPlain = "今天干什么";
    const nextRaw = "今天干什么明天休息";

    const delta = extractComposerSpeechTranscriptDelta(baseline, nextRaw);
    expect(delta).toBe("明天休息");

    const stripped = stripComposerSpeechDeltaOverlap(delta, lastSentPlain);
    expect(stripped).toBe("明天休息");
  });

  test("Bug B 真实回归：trigger 内 lastSentPlain 漏写 → 输入框残留的已发送段被重发", () => {
    // 真实 Bug B 场景：silent auto-send 第二次触发时，输入框已被 polish
    // 异步覆盖过 polished 文本（可能含已发送段，因 polish 仅整理不重置 ref），
    // 同时 lastSentPlain 在 trigger 内漏写。
    // hook 内 `stripComposerSpeechDeltaOverlap(rawPlain, lastSent)` 用于
    // 剥掉输入框 rawPlain 中已发送的部分；若 lastSent 为空，rawPlain 中的
    // 已发送段不被剥，silent auto-send 会把"已发送段+新内容"一起重发。
    //
    // 这条断言：lastSentPlain 修复前为空 → strip 不剥 → 残留已发送段 + 新内容
    // 被一起送出（重发）。
    const rawPlainInComposer = "今天干什么然后呢"; // polish 后输入框里同时有已发送段和续说
    const buggyLastSentPlain = ""; // 漏写
    const stripped = stripComposerSpeechDeltaOverlap(rawPlainInComposer, buggyLastSentPlain);
    expect(stripped).toBe("今天干什么然后呢"); // 整段被发送（含已发送段 → 重发）
  });

  test("Bug B 修复后：lastSentPlain 正确同步写，输入框已发送段被剥", () => {
    // 对照上条：trigger 内同步写 lastSentPlain = "今天干什么"，
    // 下次 silent auto-send 剥 rawPlain 时已发送段被剥掉，只发新内容。
    const rawPlainInComposer = "今天干什么然后呢";
    const fixedLastSentPlain = "今天干什么";
    const stripped = stripComposerSpeechDeltaOverlap(rawPlainInComposer, fixedLastSentPlain);
    expect(stripped).toBe("然后呢");
  });
});
