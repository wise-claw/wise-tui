import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { Window } from "happy-dom";
import type { Repository } from "../types";

const dom = new Window();
const frameListeners = new Set<unknown>();
const exitListeners = new Set<unknown>();
const themeListeners = new Set<unknown>();
function subscribe(set: Set<unknown>, listener: unknown) {
  set.add(listener);
  return () => { set.delete(listener); };
}
mock.module("../services/events", () => ({
  subscribeTerminalFrame: (listener: unknown) => subscribe(frameListeners, listener),
  subscribeTerminalExit: (listener: unknown) => subscribe(exitListeners, listener),
}));
mock.module("../stores/terminalThemeStore", () => ({
  getTerminalThemeState: () => ({ dark: true }),
  subscribeTerminalTheme: (listener: unknown) => subscribe(themeListeners, listener),
}));
mock.module("../utils/alacrittyTerminalCanvas", () => ({
  measureTerminalMetrics: () => ({ cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 }),
  readTerminalPalette: () => ({}), resetTerminalPaintQuality: () => {},
  releaseTerminalCanvas: () => {}, renderTerminalFrame: () => {},
  noteTerminalPaintDuration: () => {}, encodeTerminalKey: () => "",
  wheelDeltaToScrollLines: () => 0, TERMINAL_FONT_SIZE: 14,
}));
let rejectAttach: (reason: Error) => void;
let resolveAttach: (value: unknown) => void;
let resolveOpen: () => void;
const attach = mock(() => new Promise((resolve, reject) => { resolveAttach = resolve; rejectAttach = reject; }));
const open = mock(() => new Promise<void>((resolve) => { resolveOpen = resolve; }));
const close = mock(async () => {});
mock.module("../services/terminal", () => ({
  attachTerminalSession: attach, openTerminalSession: open, closeTerminalSession: close,
  resizeTerminalSession: async () => {}, scrollTerminalSession: async () => {}, writeTerminalSession: async () => {},
}));
const { useTerminalSession } = await import("./useTerminalSession");

const observers = new Set<unknown>();
class Observer {
  observe() { observers.add(this); }
  disconnect() { observers.delete(this); }
}
const previous = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const globals = {
    window: dom, document: dom.document, Element: dom.Element,
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
afterAll(() => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.happyDOM.cancelAsync();
});

function Probe({ visible = true, closeOnUnmount = false }: { visible?: boolean; closeOnUnmount?: boolean }) {
  const api = useTerminalSession({
    workspaceId: "workspace", activeTerminalId: "terminal", isVisible: visible,
    activeRepository: { path: "/tmp" } as Repository,
    focusRequestVersion: 0, closeOnUnmount,
  });
  return createElement("div", { ref: api.containerRef },
    createElement("canvas", { ref: api.canvasRef }),
    createElement("textarea", { ref: api.inputRef }));
}
function createNodeMock(element: { type: string }) {
  const node = dom.document.createElement(element.type);
  Object.defineProperties(node, { clientWidth: { value: 640 }, clientHeight: { value: 480 } });
  return node;
}
async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); });
  }
  throw new Error("terminal bootstrap did not reach expected state");
}
function expectReleased() {
  expect(frameListeners.size).toBe(0);
  expect(exitListeners.size).toBe(0);
  expect(themeListeners.size).toBe(0);
  expect(observers.size).toBe(0);
}

for (const outcome of ["success", "missing"] as const) {
  test(`unmount during attach releases subscriptions immediately (${outcome})`, async () => {
    attach.mockClear(); open.mockClear(); close.mockClear();
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(createElement(Probe), { createNodeMock }); });
    await waitUntil(() => attach.mock.calls.length === 1);
    expect(frameListeners.size).toBe(1);
    expect(observers.size).toBe(2);
    await act(async () => { renderer.unmount(); });
    expectReleased();
    await act(async () => {
      if (outcome === "success") resolveAttach({ frame: {} });
      else rejectAttach(new Error("terminal session not found"));
    });
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expectReleased();
  });
}

test("unmount during open releases UI resources and closes a late PTY when requested", async () => {
  attach.mockClear(); open.mockClear(); close.mockClear();
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(createElement(Probe, { closeOnUnmount: true }), { createNodeMock }); });
  await waitUntil(() => attach.mock.calls.length === 1);
  await act(async () => { rejectAttach(new Error("terminal session not found")); });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
  expectReleased();
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { resolveOpen(); });
  expect(close).toHaveBeenCalledTimes(2);
  expect(attach).toHaveBeenCalledTimes(1);
  expectReleased();
});

test("repeated hide/show while attach is pending does not accumulate subscriptions", async () => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(createElement(Probe, { visible: false }), { createNodeMock }); });
  try {
    for (let i = 0; i < 30; i++) {
      attach.mockClear();
      await act(async () => { renderer.update(createElement(Probe, { visible: true })); });
      await waitUntil(() => attach.mock.calls.length === 1);
      expect(frameListeners.size).toBe(1);
      const reject = rejectAttach;
      await act(async () => { renderer.update(createElement(Probe, { visible: false })); });
      expectReleased();
      await act(async () => { reject(new Error("terminal session not found")); });
      expectReleased();
    }
  } finally {
    await act(async () => { renderer.unmount(); });
  }
});
