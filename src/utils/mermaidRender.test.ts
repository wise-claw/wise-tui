import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { renderMermaidInContainer, resetMermaidRenderStateForTests } from "./mermaidRender";

type ObserverCallback = IntersectionObserverCallback;

let domWindow: Window;
let lastObserver: {
  callback: ObserverCallback;
  observe: ReturnType<typeof mock>;
  disconnect: ReturnType<typeof mock>;
} | null = null;

function makeMermaidBlock(statusText = "流程图将在可见时渲染…"): {
  block: HTMLDivElement;
  status: HTMLDivElement;
  container: HTMLDivElement;
} {
  const block = document.createElement("div");
  block.className = "app-markdown-mermaid";
  Object.defineProperty(block, "isConnected", { value: true, configurable: true });
  const status = document.createElement("div");
  status.className = "app-markdown-mermaid__status";
  status.textContent = statusText;
  const source = document.createElement("pre");
  source.className = "app-markdown-mermaid__source";
  source.textContent = "graph TD; A-->B;";
  block.append(status, source);
  const container = document.createElement("div");
  container.append(block);
  return { block, status, container };
}

describe("renderMermaidInContainer viewport deferral", () => {
  beforeEach(() => {
    resetMermaidRenderStateForTests();
    lastObserver = null;
    domWindow = new Window();
    globalThis.document = domWindow.document as unknown as Document;
    globalThis.window = domWindow as unknown as Window & typeof globalThis;

    (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
      class MockIntersectionObserver {
        readonly callback: ObserverCallback;
        readonly observe = mock((_target: Element) => {});
        readonly unobserve = mock((_target: Element) => {});
        readonly disconnect = mock(() => {});
        constructor(callback: ObserverCallback) {
          this.callback = callback;
          lastObserver = {
            callback,
            observe: this.observe,
            disconnect: this.disconnect,
          };
        }
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
        readonly root = null;
        readonly rootMargin = "";
        readonly thresholds: number[] = [];
      } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    resetMermaidRenderStateForTests();
    lastObserver = null;
    domWindow.close();
  });

  test("schedules IntersectionObserver and does not start render until intersecting", async () => {
    const { block, status, container } = makeMermaidBlock();

    await renderMermaidInContainer(container);

    expect(lastObserver).not.toBeNull();
    expect(lastObserver?.observe).toHaveBeenCalledWith(block);
    expect(block.getAttribute("data-mermaid-rendered")).toBeNull();
    expect(status.textContent).toBe("流程图将在可见时渲染…");
  });

  test("observes the container itself when it is a mermaid block", async () => {
    const { block, status } = makeMermaidBlock();

    await renderMermaidInContainer(block);

    expect(lastObserver).not.toBeNull();
    expect(lastObserver?.observe).toHaveBeenCalledWith(block);
    expect(status.textContent).toBe("流程图将在可见时渲染…");
  });

  test("without IntersectionObserver, starts render immediately", async () => {
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    const { block, status, container } = makeMermaidBlock();

    const pending = renderMermaidInContainer(container);
    await Promise.resolve();
    expect(status.textContent).toBe("正在渲染流程图…");
    Object.defineProperty(block, "isConnected", { value: false });
    await pending.catch(() => undefined);
  });
});
