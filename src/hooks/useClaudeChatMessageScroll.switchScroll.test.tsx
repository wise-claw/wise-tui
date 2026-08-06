import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeMessage, ClaudeSession } from "../types";
import { useClaudeChatMessageScroll } from "./useClaudeChatMessageScroll";
import {
  getClaudeChatMessageScrollBridge,
  getClaudeChatUserPausedFollow,
  registerClaudeChatMessageScrollBridge,
} from "../stores/claudeChatMessageScrollBridge";

/**
 * 回归测试：点击工作区/侧栏切换会话后，加载出的消息必须滚动到最底部。
 *
 * 只导入 `useClaudeChatMessageScroll`（其 import 链中 `ClaudeVirtualMessageList` 为
 * type-only，不引入 LiveHost / 虚拟列表等重型模块），避免模块加载期读全局而污染
 * bun 复用 worker 进程中的其它测试文件。
 *
 * 滚动容器模拟浏览器行为：scrollHeight 由行数与行高决定、scrollTop 读取时 clamp、
 * 位置变化时异步派发 scroll 事件。
 */

const ROW_H = 60;
const CLIENT_H = 200;

let domWindow: Window | null = null;
let rafCallbacks: Array<FrameRequestCallback> = [];
let container: HTMLElement;
let root: Root | null = null;
/** 行高表：切换会话后可经 harness 改变行高，模拟虚拟窗口 / Markdown 数帧后才稳定的布局。 */
let rowHeightBySessionId: Record<string, number> = {};

/** 本文件覆写的全局键：bun 会复用 worker 进程跑多个测试文件，afterEach 必须逐一恢复，避免污染后续文件。 */
const OVERRIDDEN_GLOBAL_KEYS = [
  "window", "document", "HTMLElement", "HTMLDivElement", "Element",
  "MutationObserver", "CSS", "Node", "performance", "Event", "ResizeObserver",
  "requestAnimationFrame", "cancelAnimationFrame",
  "getComputedStyle", "setTimeout", "clearTimeout", "requestIdleCallback",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
let savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
  savedGlobals = {};
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    savedGlobals[key] = (globalThis as unknown as Record<string, unknown>)[key];
  }
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  domWindow = new Window({ url: "http://localhost/" });
  const w = domWindow as unknown as Window & {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame: (handle: number) => void;
  };
  for (const key of [
    "window", "document", "HTMLElement", "HTMLDivElement", "Element",
    "MutationObserver", "CSS", "Node", "performance", "Event", "ResizeObserver",
  ]) {
    const value = (domWindow as unknown as Record<string, unknown>)[key];
    if (value) {
      try {
        (globalThis as unknown as Record<string, unknown>)[key] = value;
      } catch {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
    }
  }
  rafCallbacks = [];
  w.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  }) as typeof globalThis.requestAnimationFrame;
  w.cancelAnimationFrame = ((handle: number): void => {
    const idx = handle - 1;
    if (idx >= 0 && idx < rafCallbacks.length) rafCallbacks[idx] = () => {};
  }) as typeof globalThis.requestAnimationFrame;
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = w.requestAnimationFrame;
  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = w.cancelAnimationFrame;
  (globalThis as unknown as Record<string, unknown>).getComputedStyle = domWindow.getComputedStyle.bind(domWindow);
  (globalThis as unknown as Record<string, unknown>).setTimeout = domWindow.setTimeout.bind(domWindow);
  (globalThis as unknown as Record<string, unknown>).clearTimeout = domWindow.clearTimeout.bind(domWindow);
  (globalThis as unknown as Record<string, unknown>).requestIdleCallback = (cb: IdleRequestCallback) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0) as unknown as number;
  rowHeightBySessionId = {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null as unknown as HTMLElement;
  domWindow = null;
  rafCallbacks = [];
  rowHeightBySessionId = {};
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    const value = savedGlobals[key];
    try {
      (globalThis as unknown as Record<string, unknown>)[key] = value;
    } catch {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
  savedGlobals = {};
});

function makeMessage(id: number, role: ClaudeMessage["role"] = "assistant"): ClaudeMessage {
  return { id, role, content: `msg-${id} ` + "x".repeat(20), parts: [], timestamp: 0 };
}

function makeSession(id: string, count: number, status: ClaudeSession["status"] = "idle"): ClaudeSession {
  return {
    id,
    claudeSessionId: null,
    repositoryPath: "",
    repositoryName: "",
    model: "",
    status,
    // 交替 user/assistant，避免连续 assistant 被折叠成单个气泡
    messages: Array.from({ length: count }, (_, i) => makeMessage(i + 1, i % 2 === 0 ? "user" : "assistant")),
    createdAt: 0,
    pendingPrompt: "",
  };
}

function Host({ session }: { session: ClaudeSession }) {
  const {
    messagesScrollRef,
    scrollMessageTargetIntoView,
    scrollToSessionMessageId,
    pauseFollowForMessageNavigation,
  } = useClaudeChatMessageScroll({ session });
  // 与 ClaudeChatMessagesLiveHost 一致：把 hook 的定位/暂停能力注册到共享 bridge。
  useEffect(
    () =>
      registerClaudeChatMessageScrollBridge({
        scrollToSessionMessageId,
        scrollMessageTargetIntoView,
        pauseFollowForMessageNavigation,
      }),
    [pauseFollowForMessageNavigation, scrollMessageTargetIntoView, scrollToSessionMessageId],
  );
  const rowH = rowHeightBySessionId[session.id] ?? ROW_H;
  return (
    <div ref={messagesScrollRef} className="host-scroll" data-session-id={session.id} tabIndex={0}>
      {session.messages.map((m) => (
        <div key={m.id} className="app-claude-message" data-message-id={m.id} style={{ height: rowH }}>
          {m.content}
        </div>
      ))}
    </div>
  );
}

function getScrollEl(): HTMLDivElement {
  const el = container.querySelector(".host-scroll") as HTMLDivElement;
  if (!el) throw new Error("scroll el missing");
  return el;
}

/** 模拟浏览器滚动容器：scrollHeight 由行数 × 行高决定；scrollTop 读取时 clamp、写入时异步派发 scroll 事件。 */
function installBrowserLikeScroll(sc: HTMLDivElement): void {
  let value = 0;
  let lastDispatched = 0;
  Object.defineProperty(sc, "clientHeight", { configurable: true, value: CLIENT_H });
  Object.defineProperty(sc, "scrollHeight", {
    configurable: true,
    get() {
      const sid = sc.getAttribute("data-session-id") ?? "";
      const rowH = rowHeightBySessionId[sid] ?? ROW_H;
      return sc.querySelectorAll(".app-claude-message").length * rowH;
    },
  });
  const clamp = () => Math.max(0, Math.min(value, sc.scrollHeight - sc.clientHeight));
  Object.defineProperty(sc, "scrollTop", {
    configurable: true,
    get() {
      return clamp();
    },
    set(v: number) {
      const prev = value;
      value = Math.max(0, v);
      value = clamp();
      if (Math.abs(value - prev) > 0.5) {
        Promise.resolve().then(() => {
          if (Math.abs(sc.scrollTop - lastDispatched) > 0.5) {
            lastDispatched = sc.scrollTop;
            sc.dispatchEvent(new Event("scroll"));
          }
        });
      }
    },
  });
}

function flushRaf(): void {
  for (let round = 0; round < 4; round++) {
    const drained = rafCallbacks.splice(0, rafCallbacks.length);
    for (const cb of drained) cb(performance.now());
    if (rafCallbacks.length === 0) break;
  }
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
  act(() => flushRaf());
}

function expectAtBottom(sc: HTMLDivElement, rows: number, rowH: number = ROW_H): void {
  expect(sc.scrollTop).toBe(Math.max(0, rows * rowH - CLIENT_H));
}

describe("会话切换后消息列表贴底", () => {
  test("磁盘会话切换：A 在底部 → B 瞬间为空 → 异步灌入后贴底", async () => {
    rowHeightBySessionId = { A: ROW_H, B: ROW_H };
    await act(async () => {
      root!.render(<Host session={makeSession("A", 10)} />);
    });
    const sc = getScrollEl();
    installBrowserLikeScroll(sc);
    await tick(500);
    expectAtBottom(sc, 10);

    // 切到 B：B 尚无消息（磁盘加载中）→ 空态
    await act(async () => {
      root!.render(<Host session={makeSession("B", 0)} />);
    });
    await tick(60);
    expect(sc.scrollTop).toBe(0);

    // 磁盘异步灌入 B 的完整消息 → 必须贴底
    await act(async () => {
      root!.render(<Host session={makeSession("B", 12)} />);
    });
    await tick(500);
    expectAtBottom(sc, 12);
  });

  test("内存中非空会话直接切换：A(10)→B(30) 与 B→C(3) 均贴底", async () => {
    rowHeightBySessionId = { A: ROW_H, B: ROW_H, C: ROW_H };
    await act(async () => {
      root!.render(<Host session={makeSession("A", 10)} />);
    });
    const sc = getScrollEl();
    installBrowserLikeScroll(sc);
    await tick(500);
    expectAtBottom(sc, 10);

    // 切到更长的 B
    await act(async () => {
      root!.render(<Host session={makeSession("B", 30)} />);
    });
    await tick(500);
    expectAtBottom(sc, 30);

    // 再切到更短的 C
    await act(async () => {
      root!.render(<Host session={makeSession("C", 3)} />);
    });
    await tick(500);
    expectAtBottom(sc, 3);
  });

  test("A 中用户暂停贴底（向上滚动阅读）→ 切到 B 后仍应贴底", async () => {
    rowHeightBySessionId = { A: ROW_H, B: ROW_H };
    await act(async () => {
      root!.render(<Host session={makeSession("A", 10)} />);
    });
    const sc = getScrollEl();
    installBrowserLikeScroll(sc);
    await tick(500);
    expectAtBottom(sc, 10);

    // 用户暂停贴底（消息定位/滚动共享的暂停通道）
    act(() => {
      getClaudeChatMessageScrollBridge().pauseFollowForMessageNavigation();
    });

    // 切到 B
    await act(async () => {
      root!.render(<Host session={makeSession("B", 30)} />);
    });
    await tick(500);
    expectAtBottom(sc, 30);
  });

  test("同引用切换（B 复用 A 的 messages 快照）+ 暂停 → 布局数帧稳定后仍贴底", async () => {
    const shared = makeSession("A", 10).messages;
    const sessionA = { ...makeSession("A", 10), messages: shared };
    rowHeightBySessionId = { A: ROW_H, B: ROW_H * 2 };
    await act(async () => {
      root!.render(<Host session={sessionA} />);
    });
    const sc = getScrollEl();
    installBrowserLikeScroll(sc);
    await tick(500);
    expectAtBottom(sc, 10);

    // 用户暂停贴底
    act(() => {
      getClaudeChatMessageScrollBridge().pauseFollowForMessageNavigation();
    });

    // 切到 B：session.id 变化但 messages 引用不变 → 布局贴底 effect 不重跑；
    // 行高由 harness 在数帧后变化，模拟虚拟窗口 / Markdown 延迟稳定。
    await act(async () => {
      root!.render(<Host session={{ ...sessionA, id: "B" }} />);
    });
    await tick(60);
    // 切换定时器（IDLE_HYDRATE_SCROLL_DEBOUNCE_MS + 120ms）尚未到点，不能提前贴到新底
    expect(sc.scrollTop).toBeLessThan(10 * ROW_H * 2 - CLIENT_H);

    await tick(500);
    expectAtBottom(sc, 10, ROW_H * 2);
  });

  test("贴底时内容高度骤降触发的 scroll 不暂停跟随：后续新消息仍自动展示", async () => {
    rowHeightBySessionId = { R: ROW_H };
    await act(async () => {
      root!.render(<Host session={makeSession("R", 20, "idle")} />);
    });
    const sc = getScrollEl();
    installBrowserLikeScroll(sc);
    await tick(200);
    expectAtBottom(sc, 20);
    expect(getClaudeChatUserPausedFollow()).toBe(false);

    // 模拟尾部窗口回收：内容高度骤降，浏览器 clamp scrollTop，仍停留在新底部。
    // 旧逻辑会把这次 scroll 当成用户上翻并关掉跟随。
    rowHeightBySessionId = { R: ROW_H / 2 };
    act(() => {
      // 写入超大 scrollTop → harness clamp 到新底部并派发 scroll（等同浏览器回收后的 clamp）
      sc.scrollTop = 99999;
    });
    await tick(50);
    for (let i = 0; i < 4; i++) act(() => flushRaf());
    expect(getClaudeChatUserPausedFollow()).toBe(false);
    expectAtBottom(sc, 20, ROW_H / 2);

    // 继续追加消息：跟随必须仍开着，末条自动入视口
    await act(async () => {
      root!.render(<Host session={makeSession("R", 28, "idle")} />);
    });
    await tick(200);
    expect(getClaudeChatUserPausedFollow()).toBe(false);
    expectAtBottom(sc, 28, ROW_H / 2);

    // 真正上翻离开底部时仍应暂停
    act(() => {
      sc.scrollTop = 0;
    });
    await tick(50);
    for (let i = 0; i < 4; i++) act(() => flushRaf());
    expect(getClaudeChatUserPausedFollow()).toBe(true);
  });
});
