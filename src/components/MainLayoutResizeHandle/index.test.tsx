import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, create } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { MainLayoutResizeHandle } from "./index";

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
  // 把 window 上的 rAF / cAF 替换为手动驱动版本，让测试可控。
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
    document.body.classList.remove("app-main-layout-resizing");
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
    if (typeof cls === "string") return cls.includes("app-main-layout-resize-handle");
    if (Array.isArray(cls)) return cls.some((c) => String(c).includes("app-main-layout-resize-handle"));
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
  preventDefault: () => void;
  currentTarget: ReactTestInstance;
  nativeEvent: { pointerId: number };
}>): React.PointerEvent<HTMLDivElement> {
  return partial as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("MainLayoutResizeHandle", () => {
  test("向左拖：right variant 时宽度 = startWidth - delta", () => {
    const calls: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MainLayoutResizeHandle
          variant="right"
          startWidthPx={300}
          onWidthChange={(n) => calls.push(n)}
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
          clientX: 100,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    expect(document.body.classList.contains("app-main-layout-resizing")).toBe(true);

    // 移动到 clientX=140 → right variant，delta=+40，宽度 = 300 - 40 = 260
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientX: 140, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(calls).toEqual([260]);

    // 同帧内连发两次 move：应合并为 1 次 commit（rAF 合批）
    const before = calls.length;
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientX: 160, preventDefault: () => {} }),
      );
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 1, clientX: 180, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(calls.length - before).toBe(1);
    // 180: 300 - (180-100) = 220
    expect(calls[calls.length - 1]).toBe(220);

    // 释放
    act(() => {
      handle.props.onPointerUp(pointerEvent({ pointerId: 1, nativeEvent: { pointerId: 1 } }));
    });
    expect(document.body.classList.contains("app-main-layout-resizing")).toBe(false);
  });

  test("向右拖：left variant 时宽度 = startWidth + delta", () => {
    const calls: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MainLayoutResizeHandle
          variant="left"
          startWidthPx={260}
          onWidthChange={(n) => calls.push(n)}
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
          clientX: 50,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 2, clientX: 90, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(calls).toEqual([260 + 40]);
  });

  test("松开后 flush 最后一帧，且释放后 move 不再 commit", () => {
    const calls: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MainLayoutResizeHandle
          variant="left"
          startWidthPx={260}
          onWidthChange={(n) => calls.push(n)}
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
          clientX: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 3, clientX: 30, preventDefault: () => {} }),
      );
    });
    // 不 flushRaf，直接 pointerup：endDrag 内部应同步 flush 最后一次。
    act(() => {
      handle.props.onPointerUp(pointerEvent({ pointerId: 3, nativeEvent: { pointerId: 3 } }));
    });
    expect(calls).toEqual([290]);

    // 释放后再次 move 不应触发 commit
    const before = calls.length;
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 3, clientX: 999, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(calls.length).toBe(before);
  });

  test("不同 pointerId 的 move 被忽略（多指 / 串扰场景）", () => {
    const calls: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MainLayoutResizeHandle
          variant="left"
          startWidthPx={260}
          onWidthChange={(n) => calls.push(n)}
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
          clientX: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    act(() => {
      handle.props.onPointerMove(
        pointerEvent({ pointerId: 999, clientX: 50, preventDefault: () => {} }),
      );
    });
    flushRaf();
    expect(calls).toEqual([]);
  });

  test("visibilitychange 切到 hidden 强制释放", () => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MainLayoutResizeHandle variant="left" startWidthPx={260} onWidthChange={() => {}} />,
      );
    });
    const handle = findHandle(renderer!.root);
    act(() => {
      handle.props.onPointerDown(
        pointerEvent({
          button: 0,
          pointerId: 7,
          pointerType: "mouse",
          clientX: 0,
          preventDefault: () => {},
          currentTarget: handle,
        }),
      );
    });
    expect(document.body.classList.contains("app-main-layout-resizing")).toBe(true);

    // happy-dom 不接受全局 new Event，这里改用 happy-dom 自家的 document 派发方式。
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const HiddenEventCtor = (domWindow as unknown as { Event: new (t: string) => unknown }).Event;
    const ev = new HiddenEventCtor("visibilitychange");
    act(() => {
      document.dispatchEvent(ev as unknown as Event);
    });
    expect(document.body.classList.contains("app-main-layout-resizing")).toBe(false);
  });
});