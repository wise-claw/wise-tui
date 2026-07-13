import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, create } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { RepoPanelSplitResizeHandle } from "./index";

// ── happy-dom 全局环境 ──
let domWindow: Window | null = null;
let rafCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  domWindow = new Window({ url: "http://localhost/" });
  const w = domWindow as unknown as Window & {
    requestAnimationFrame: typeof globalThis.requestAnimationFrame;
    cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
  };
  for (const key of ["window", "document", "HTMLElement", "HTMLDivElement"]) {
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
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  if (typeof document !== "undefined") {
    document.body.classList.remove("app-repo-panel-split-resizing");
  }
  domWindow = null;
  rafCallbacks = [];
});

function flushRaf(): void {
  const drained = rafCallbacks.splice(0, rafCallbacks.length);
  for (const cb of drained) cb(performance.now());
}

function findHandle(root: ReactTestInstance): ReactTestInstance {
  const divs = root.findAll(
    (n) => typeof n.type === "string" && (n.type as string) === "div",
  );
  const handle = divs.find((n) => {
    const cls = n.props.className;
    if (typeof cls === "string") return cls.includes("app-repo-panel-split-resize-handle");
    if (Array.isArray(cls))
      return cls.some((c) => String(c).includes("app-repo-panel-split-resize-handle"));
    return false;
  });
  if (!handle) throw new Error("handle not found");
  return handle;
}

function pointerEvent(partial: Partial<{
  button: number;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  currentTarget: ReactTestInstance;
  nativeEvent: { pointerId: number };
}>): React.PointerEvent<HTMLDivElement> {
  return partial as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("RepoPanelSplitResizeHandle", () => {
  test("向下拖：height = startHeight - deltaY", () => {
    const changes: number[] = [];
    const commits: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RepoPanelSplitResizeHandle
          startHeightPx={230}
          onHeightChange={(n) => changes.push(n)}
          onHeightCommit={(n) => commits.push(n)}
        />,
      );
    });
    const handle = findHandle(renderer!.root);

    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 1,
          pointerType: "mouse",
          clientY: 100,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    expect(document.body.classList.contains("app-repo-panel-split-resizing")).toBe(true);

    // 向下移到 clientY=140 → delta=+40 → height = 230 - 40 = 190（拖把朝下，git 跟着下沿下移变矮）
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientY: 140, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(changes).toEqual([190]);

    // 同帧内两次 move：合并为 1 次 commit
    const before = changes.length;
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientY: 180, preventDefault: () => {} }),
      );
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientY: 200, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(changes.length - before).toBe(1);
    expect(changes[changes.length - 1]).toBe(230 - (200 - 100));

    // 释放：触发一次 commit
    act(() => {
      handle.props.onPointerUp(pointerEvent({ pointerId: 1, nativeEvent: { pointerId: 1 } }));
    });
    expect(document.body.classList.contains("app-repo-panel-split-resizing")).toBe(false);
    expect(commits.length).toBe(1);
    expect(commits[commits.length - 1]).toBe(230 - 100);
  });

  test("向上拖：height = startHeight - deltaY（deltaY 为负）→ Git 变高", () => {
    const changes: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RepoPanelSplitResizeHandle
          startHeightPx={260}
          onHeightChange={(n) => changes.push(n)}
        />,
      );
    });
    const handle = findHandle(renderer!.root);
    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 2,
          pointerType: "mouse",
          clientY: 50,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 2, clientY: 10, preventDefault: () => {} }),
      );
    });
    flushRaf();
    // clientY 50→10：delta=-40，next = 260 - (-40) = 300
    expect(changes).toEqual([300]);
  });

  test("松开后 flush 最后一帧，且释放后 move 不再 commit", () => {
    const changes: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RepoPanelSplitResizeHandle
          startHeightPx={260}
          onHeightChange={(n) => changes.push(n)}
        />,
      );
    });
    const handle = findHandle(renderer!.root);
    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 3,
          pointerType: "mouse",
          clientY: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 3, clientY: 30, preventDefault: () => {} }),
      );
    });
    // 不 flushRaf，直接 pointerup：endDrag 内部应同步 flush 最后一次。
    // clientY 0→30：delta=+30，next = 260 - 30 = 230
    act(() => {
      handle.props.onPointerUp(pointerEvent({ pointerId: 3, nativeEvent: { pointerId: 3 } }));
    });
    expect(changes).toEqual([230]);

    // 释放后再次 move 不应触发 commit
    const before = changes.length;
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 3, clientY: 999, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(changes.length).toBe(before);
  });

  test("不同 pointerId 的 move 被忽略（多指 / 串扰场景）", () => {
    const changes: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RepoPanelSplitResizeHandle
          startHeightPx={260}
          onHeightChange={(n) => changes.push(n)}
        />,
      );
    });
    const handle = findHandle(renderer!.root);
    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 5,
          pointerType: "mouse",
          clientY: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 999, clientY: 50, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(changes).toEqual([]);
  });

  test("visibilitychange 切到 hidden 强制释放", () => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RepoPanelSplitResizeHandle
          startHeightPx={260}
          onHeightChange={() => {}}
        />,
      );
    });
    const handle = findHandle(renderer!.root);
    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 7,
          pointerType: "mouse",
          clientY: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    expect(document.body.classList.contains("app-repo-panel-split-resizing")).toBe(true);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const HiddenEventCtor = (domWindow as unknown as { Event: new (t: string) => unknown }).Event;
    const ev = new HiddenEventCtor("visibilitychange");
    act(() => {
      document.dispatchEvent(ev as unknown as Event);
    });
    expect(document.body.classList.contains("app-repo-panel-split-resizing")).toBe(false);
  });
});