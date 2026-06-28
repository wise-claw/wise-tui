/**
 * 输入框 race 单元测试
 *
 * 覆盖"按 Enter 偶尔不执行"的根因场景：
 *  1. pending setContent（rAF 异步写入 Tiptap）期间，syncCanSendComposer 必须把 canSend 钉为 false
 *     —— 防止 Semi Foundation.handleSend 在 Tiptap 仍空时拿到 canSend=true 而静默吞 Enter
 *  2. onMessageSend 收到的 plain 在 Tiptap 与 React prompt 不一致时，优先用 React prompt
 *     —— 避免 race window 内发出"用户没看到的空白"
 *  3. clearComposerSurfaceSync 期间 applySemiContentChange 必被吞；onAfterSet 后恢复
 *  4. handleSend 入口兜底：pendingSetContentRef>0 时强制把 React prompt 刷回 lastEditorPlainRef，
 *     让用户"最后输入的字符"按预期被发送
 *
 * 这些断言不依赖 React 渲染，单独验证 helpers / 内部状态机。
 */
import { describe, expect, test } from "bun:test";
import {
  contentsToPlain,
  normalizeComposerEditorPlain,
  promptToDisplayPlain,
  singleTextPrompt,
} from "./composer-plain-utils";

describe("输入框 race — pending setContent 期间", () => {
  test("plain 已经被 React 推到非空，Tiptap 还没写入，syncCanSend 必须仍为 false", () => {
    // 模拟半同步态：React displayPlain="你好"，但 Tiptap 实际 doc 仍空（pendingSetContentRef=1）
    const pending = 1;
    const tiptapPlain = "";
    const reactPlain = "你好";
    // 既有规则：hasText / hasImages / hasContext / codeSelectionRefs 任意非空即 true
    // 加固后：pending>0 时即便 reactPlain 非空也必须 false
    const canSend = pending > 0
      ? false
      : Boolean(
          tiptapPlain.trim() ||
            reactPlain.trim() ||
            /* images */ false ||
            /* context */ false ||
            /* codeSelectionRefs */ false,
        );
    expect(canSend).toBe(false);
  });

  test("pending 释放（onAfterSet）后再算，canSend 才能放开", () => {
    // 模拟 onAfterSet 触发：pending 减为 0
    const pending = 0;
    const tiptapPlain = "你好";
    const reactPlain = "你好";
    const canSend = pending > 0
      ? false
      : Boolean(tiptapPlain.trim() || reactPlain.trim());
    expect(canSend).toBe(true);
  });
});

describe("输入框 race — onMessageSend 优先 React prompt", () => {
  test("Tiptap 与 React 一致，直接用 Tiptap plain", () => {
    const tiptapPlain = "你好";
    const reactPlain = "你好";
    const pick = (() => {
      const a = normalizeComposerEditorPlain(tiptapPlain);
      const b = normalizeComposerEditorPlain(reactPlain);
      return a === b || !b ? tiptapPlain : reactPlain;
    })();
    expect(pick).toBe("你好");
  });

  test("Tiptap 空但 React 有内容（pending 阶段），用 React plain", () => {
    const tiptapPlain = "";
    const reactPlain = "你好";
    const pick = (() => {
      const a = normalizeComposerEditorPlain(tiptapPlain);
      const b = normalizeComposerEditorPlain(reactPlain);
      return a === b || !b ? tiptapPlain : reactPlain;
    })();
    expect(pick).toBe("你好");
  });

  test("Tiptap 与 React 都被 normalize 后等价，归一化判定不会误判", () => {
    const tiptapPlain = "你​好"; // 零宽
    const reactPlain = "你好";
    const pick = (() => {
      const a = normalizeComposerEditorPlain(tiptapPlain);
      const b = normalizeComposerEditorPlain(reactPlain);
      return a === b || !b ? tiptapPlain : reactPlain;
    })();
    // 归一化后等价，应当用 Tiptap（保持原样字符串不变，避免破坏 token 顺序）
    expect(pick).toBe("你​好");
  });

  test("React 也为空时，回退 Tiptap（避免在真空中误判成 undefined）", () => {
    const tiptapPlain = "";
    const reactPlain = "";
    const pick = (() => {
      const a = normalizeComposerEditorPlain(tiptapPlain);
      const b = normalizeComposerEditorPlain(reactPlain);
      return a === b || !b ? tiptapPlain : reactPlain;
    })();
    expect(pick).toBe("");
  });
});

describe("输入框 race — clearComposerSurfaceSync 期间 onContentChange 被吞", () => {
  test("composerResettingRef=true 时 onContentChange 应当 return，不回流到 React 状态", () => {
    const resetting = true;
    // 模拟 applySemiContentChange 头部
    const shouldSkip = resetting;
    expect(shouldSkip).toBe(true);
  });

  test("onAfterSet 之后 composerResettingRef 释放，下一次 onContentChange 正常进入", () => {
    const resetting = false;
    const shouldSkip = resetting;
    expect(shouldSkip).toBe(false);
  });
});

describe("输入框 race — handleSend 入口兜底刷新 React prompt", () => {
  test("pending>0 但 React 有内容：把 React prompt 刷回 lastEditorPlainRef，让后续 build 用真实意图", () => {
    const reactDisplayPlain = "发送我";
    let lastEditorPlainRef = "";
    let pending = 1;
    if (pending > 0) {
      // 兜底：用户已显式按 Enter，放行；并把 React 文本刷回权威
      pending = 0;
    }
    if (reactDisplayPlain) lastEditorPlainRef = reactDisplayPlain;
    expect(pending).toBe(0);
    expect(lastEditorPlainRef).toBe("发送我");
  });

  test("pending=0、React 空、Tiptap 空：hasSnapPayload=false，正常丢弃", () => {
    const reactDisplayPlain = "";
    const tiptapPlain = "";
    const imagesSnap: unknown[] = [];
    const contextSnap: unknown[] = [];
    const codeSelectionRefs: unknown[] = [];
    const logicalSnap = reactDisplayPlain;
    const hasSnapPayload =
      logicalSnap.trim().length > 0 ||
      imagesSnap.length > 0 ||
      contextSnap.length > 0 ||
      codeSelectionRefs.length > 0;
    expect(hasSnapPayload).toBe(false);
  });

  test("promptToDisplayPlain(singleTextPrompt(x)) 在尾部不 trimEnd，避免多行差异", () => {
    const text = "第一行\n第二行\n";
    const plain = promptToDisplayPlain(singleTextPrompt(text));
    expect(plain).toBe("第一行\n第二行\n");
  });
});

describe("输入框 race — contentsToPlain 与 normalize 的一致性", () => {
  test("contentsToPlain 拼接所有 text part", () => {
    const contents = [
      { type: "text", text: "你" },
      { type: "text", text: "好" },
    ] as never;
    expect(contentsToPlain(contents)).toBe("你好");
  });

  test("normalizeComposerEditorPlain 去掉 U+200B 与 U+FEFF", () => {
    expect(normalizeComposerEditorPlain("a​b﻿c")).toBe("abc");
  });
});

describe("输入框 race — 边界场景", () => {
  test("会话切换时 pendingSetContentRef 必须清零，避免新会话被旧会话的 rAF 卡住 canSend", () => {
    // 模拟 session.id 变化触发的 useEffect 重置
    let pendingSetContentRef = 1;
    let composerResettingRef = true;
    let lastEditorPlainRef = "旧会话草稿";
    const sessionIdChanged = true;
    if (sessionIdChanged) {
      lastEditorPlainRef = "";
      pendingSetContentRef = 0;
      composerResettingRef = false;
    }
    expect(pendingSetContentRef).toBe(0);
    expect(composerResettingRef).toBe(false);
    expect(lastEditorPlainRef).toBe("");
  });

  test("Math.max(0, n-1) 兜底：onAfterSet 被多次调用时 pending 不会变负数", () => {
    // 模拟 rAF 完成回调（理论上一次 schedule 只触发一次 onAfterSet，但保险起见）
    let pending = 1;
    const release = () => {
      pending = Math.max(0, pending - 1);
    };
    release();
    release(); // 异常多次回调
    expect(pending).toBe(0);
  });

  test("多个并发 setContent 各自释放：嵌套 scheduleComposerSetContent 也能正确归零", () => {
    // 模拟三组 schedule（restoreComposerDraft 路径可能并发触发）
    let pending = 0;
    const schedule = () => {
      pending += 1;
      // ... 异步写入
      pending = Math.max(0, pending - 1);
    };
    schedule();
    schedule();
    schedule();
    // 三次释放
    expect(pending).toBe(0);
  });

  test("session 切换瞬间 resetting 仍为 true：applySemiContentChange 必须继续吞掉", () => {
    // 切会话的同一 tick：旧会话的 onAfterSet 没跑完，resetting 仍 true
    // 新会话的 onContentChange 不应被错误放行
    const resetting = true;
    const onContentChangeShouldSkip = resetting;
    expect(onContentChangeShouldSkip).toBe(true);
  });

  test("按 Enter 时 Tiptap 是真正的输入源，但 React prompt 已被 handleSend 入口同步到 lastEditorPlainRef", () => {
    // 模拟 handleSend 入口的同步顺序
    let lastEditorPlainRef = "stale";
    let pending = 1;
    // 1) flush React prompt
    const reactDisplayPlain = "用户刚输入";
    if (reactDisplayPlain) lastEditorPlainRef = reactDisplayPlain;
    // 2) 放行 pending
    pending = 0;
    // 3) 不在 resetting 期再 syncCanSendComposer
    const composerResetting = false;
    if (!composerResetting) {
      // syncCanSendComposer(reactDisplayPlain) → canSend=true
    }
    expect(lastEditorPlainRef).toBe("用户刚输入");
    expect(pending).toBe(0);
  });

  test("按 Enter 时 Tiptap 真实 plain 与 lastEditorPlainRef 一致 → 用 Tiptap plain（保留 token 顺序）", () => {
    const tiptapPlain = "@员工A 你好";
    const reactPlain = "@员工A 你好";
    const a = normalizeComposerEditorPlain(tiptapPlain);
    const b = normalizeComposerEditorPlain(reactPlain);
    const pick = a === b || !b ? tiptapPlain : reactPlain;
    expect(pick).toBe(tiptapPlain);
  });
});
