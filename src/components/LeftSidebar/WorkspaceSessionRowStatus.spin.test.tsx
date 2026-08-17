import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceSessionRowStatus } from "./WorkspaceSessionRowStatus";

/**
 * 回归测试：侧栏会话行转圈必须挂在元素上（Web Animations API）而不是依赖 CSS animation。
 * WebKit（Tauri macOS/Linux）在列表按「执行中置顶 / 最近活跃」重排时会移动 DOM 节点，
 * CSS animation 会在移动时重启/冻结（多会话运行时「转不动 / 闪帧」）；WAAPI 动画不随移动重启。
 */

let domWindow: Window | null = null;
let container: HTMLElement;
let root: Root | null = null;

const OVERRIDDEN_GLOBAL_KEYS = [
  "window", "document", "Element", "HTMLElement", "Node", "SVGSVGElement",
] as const;
let savedGlobals: Record<string, unknown> = {};

interface AnimateCall {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}
const animateCalls: AnimateCall[] = [];
const cancelledCalls: number[] = [];

function installAnimateMock() {
  animateCalls.length = 0;
  cancelledCalls.length = 0;
  const proto = (globalThis.Element as unknown as { prototype: Element }).prototype;
  (proto as unknown as { animate: unknown }).animate = (
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    const index = animateCalls.length;
    animateCalls.push({ keyframes, options });
    return {
      cancel: () => {
        cancelledCalls.push(index);
      },
    };
  };
}

function installMatchMedia(matches: boolean) {
  (domWindow as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  savedGlobals = {};
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    savedGlobals[key] = (globalThis as unknown as Record<string, unknown>)[key];
  }
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  domWindow = new Window({ url: "http://localhost/" });
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    const value = (domWindow as unknown as Record<string, unknown>)[key];
    if (value) {
      try {
        (globalThis as unknown as Record<string, unknown>)[key] = value;
      } catch {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
    }
  }
  installMatchMedia(false);
  installAnimateMock();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null as unknown as HTMLElement;
  domWindow = null;
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

describe("WorkspaceSessionRowStatus running spinner", () => {
  test("用 WAAPI 驱动无限旋转并禁用 CSS animation 兜底", () => {
    act(() => {
      root!.render(<WorkspaceSessionRowStatus status="running" />);
    });
    const svg = container.querySelector(".app-workspace-session-status__svg--spin");
    expect(svg).not.toBeNull();
    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]!.keyframes).toEqual([
      { transform: "rotate(0deg)" },
      { transform: "rotate(360deg)" },
    ]);
    expect(animateCalls[0]!.options.iterations).toBe(Infinity);
    expect(animateCalls[0]!.options.duration).toBe(750);
    // WAAPI 生效时禁掉样式表里的 CSS animation，避免 DOM 移动时被 WebKit 重启/冻结。
    expect((svg as SVGElement).style.animation).toBe("none");
  });

  test("状态切离 running 时取消动画", () => {
    act(() => {
      root!.render(<WorkspaceSessionRowStatus status="running" />);
    });
    expect(animateCalls).toHaveLength(1);
    act(() => {
      root!.render(<WorkspaceSessionRowStatus status="completed" />);
    });
    expect(cancelledCalls).toEqual([0]);
  });

  test("prefers-reduced-motion 时不启动旋转动画", () => {
    installMatchMedia(true);
    act(() => {
      root!.render(<WorkspaceSessionRowStatus status="running" />);
    });
    expect(animateCalls).toHaveLength(0);
  });

  test("旧引擎无 element.animate 时保留 CSS animation 兜底", () => {
    const proto = (globalThis.Element as unknown as { prototype: Element }).prototype;
    delete (proto as unknown as { animate?: unknown }).animate;
    act(() => {
      root!.render(<WorkspaceSessionRowStatus status="running" />);
    });
    const svg = container.querySelector(".app-workspace-session-status__svg--spin");
    expect(svg).not.toBeNull();
    expect((svg as SVGElement).style.animation).toBe("");
  });
});
