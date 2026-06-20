import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { act, Profiler, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useRepositoryExplorerPointerHover } from "./useRepositoryExplorerPointerHover";

/**
 * 验证 useRepositoryExplorerPointerHover 的 rAF 合并：连续 pointermove 事件在一帧内
 * 只触发一次 hover 更新，而非每次事件都同步 setHoverPath。这是流式/滚动期间避免
 * 高频重渲染的关键节流，回归守护——若改回同步 setHoverPath，"flush 前不更新"断言失败。
 */

let domWindow: Window;
let root: ReturnType<typeof createRoot> | null = null;
let savedGlobals: Record<string, unknown> = {};

// fake rAF：把回调入队，测试手动 flush，从而精确控制帧时序。
const rafCallbacks = new Map<number, () => void>();
let rafIdCounter = 1;

function installFakeRaf() {
  globalThis.requestAnimationFrame = ((cb: () => void) => {
    const id = rafIdCounter++;
    rafCallbacks.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafCallbacks.delete(id);
  }) as typeof cancelAnimationFrame;
}

function flushRaf() {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb();
}

function resetRaf() {
  rafCallbacks.clear();
  rafIdCounter = 1;
}

// 需要临时覆写的全局键，afterEach 里逐一恢复，避免污染后续测试。
const GLOBAL_KEYS = [
  "document",
  "window",
  "Element",
  "Node",
  "HTMLElement",
  "Event",
  "PointerEvent",
  "IntersectionObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
];

beforeEach(() => {
  savedGlobals = {};
  for (const key of GLOBAL_KEYS) {
    savedGlobals[key] = (globalThis as Record<string, unknown>)[key];
  }
  domWindow = new Window();
  globalThis.document = domWindow.document as unknown as Document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis;
  // React 的 act / react-dom 需要 Element / Node / HTMLElement 等全局类存在于 globalThis。
  globalThis.Element = domWindow.Element as unknown as typeof Element;
  globalThis.Node = domWindow.Node as unknown as typeof Node;
  globalThis.HTMLElement = domWindow.HTMLElement as unknown as typeof HTMLElement;
  globalThis.Event = domWindow.Event as unknown as typeof Event;
  globalThis.PointerEvent = domWindow.PointerEvent as unknown as typeof PointerEvent;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  installFakeRaf();
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  domWindow.close();
  resetRaf();
  for (const key of GLOBAL_KEYS) {
    const value = savedGlobals[key];
    if (value === undefined) {
      delete (globalThis as Record<string, unknown>)[key];
    } else {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  }
});

function dispatchPointerMove(target: Element, clientX: number, clientY: number) {
  const event = new domWindow.PointerEvent("pointermove", {
    bubbles: true,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
}

function renderProbe(onHover: (hover: string | null) => void) {
  function Probe() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const hover = useRepositoryExplorerPointerHover(scrollRef, true);
    useEffect(() => {
      onHover(hover);
    }, [hover]);
    return (
      <div ref={scrollRef}>
        <div className="repo-tree-node" data-repo-path="a">
          a
        </div>
        <div className="repo-tree-node" data-repo-path="b">
          b
        </div>
      </div>
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Probe />);
  });
  return container;
}

describe("useRepositoryExplorerPointerHover", () => {
  test("pointermove 后、rAF flush 前 hover 不更新（rAF 合并）", () => {
    let hover: string | null = null;
    renderProbe((h) => {
      hover = h;
    });

    const nodeA = document.querySelector<HTMLElement>('[data-repo-path="a"]')!;
    expect(nodeA).toBeTruthy();

    // 模拟高频 pointermove：事件触发后 hover 不应立即更新（rAF 尚未 flush）。
    act(() => {
      dispatchPointerMove(nodeA, 10, 10);
    });
    expect(hover).toBeNull();

    // flush rAF 后才更新到目标路径。
    act(() => {
      flushRaf();
    });
    expect(hover).toBe("a");
  });

  test("一帧内多次 pointermove 合并为一次更新（取最后一次目标）", () => {
    const hoverSequence: (string | null)[] = [];
    let hover: string | null = null;
    renderProbe((h) => {
      hover = h;
      hoverSequence.push(h);
    });

    const nodeA = document.querySelector<HTMLElement>('[data-repo-path="a"]')!;
    const nodeB = document.querySelector<HTMLElement>('[data-repo-path="b"]')!;

    // 同一帧内连续 4 次 pointermove（a→b→a→b），rAF 守卫保证只调度一次。
    act(() => {
      dispatchPointerMove(nodeA, 10, 10);
      dispatchPointerMove(nodeB, 10, 40);
      dispatchPointerMove(nodeA, 10, 10);
      dispatchPointerMove(nodeB, 10, 40);
    });
    // flush 前 hover 仍是初始 null。
    expect(hover).toBeNull();

    act(() => {
      flushRaf();
    });
    // 合并后只取最后一次目标 b。
    expect(hover).toBe("b");

    // flush 后只应新增一次 hover 变化（null → b），而非 4 次。
    const afterFlushChanges = hoverSequence.filter((h) => h !== null).length;
    expect(afterFlushChanges).toBe(1);
  });

  test("pointerleave 立即清空 hover 并取消 pending rAF", () => {
    let hover: string | null = null;
    renderProbe((h) => {
      hover = h;
    });

    const nodeA = document.querySelector<HTMLElement>('[data-repo-path="a"]')!;
    const scrollRoot = nodeA.parentElement!;

    act(() => {
      dispatchPointerMove(nodeA, 10, 10);
    });
    act(() => {
      flushRaf();
    });
    expect(hover).toBe("a");

    // 再触发一次 pointermove（排队 rAF），随后 pointerleave 应立即清空并取消 pending rAF。
    act(() => {
      dispatchPointerMove(nodeA, 10, 10);
    });
    act(() => {
      scrollRoot.dispatchEvent(new domWindow.PointerEvent("pointerleave", { bubbles: false }));
    });
    expect(hover).toBeNull();

    // pending rAF 已被取消，flush 后不应再把 hover 设回 "a"。
    const pendingBefore = rafCallbacks.size;
    act(() => {
      flushRaf();
    });
    expect(pendingBefore).toBe(0);
    expect(hover).toBeNull();
  });
});

describe("useRepositoryExplorerPointerHover 渲染节流性能", () => {
  // 用 React.Profiler 的 onRender 量化高频 pointermove 实际触发的 React 提交次数。
  // 流畅度的客观指标：渲染次数越少越流畅（60fps 帧预算 16.67ms，每次提交都占用主线程）。
  // 若改回同步 setHoverPath（每次 pointermove 都 setState），commit 增量会等于事件数，
  // 下方断言失败 —— 这是回归守护。
  function renderProbeWithProfiler(
    nodeCount: number,
    onRender: (phase: string, actualDuration: number) => void,
    onHover: (hover: string | null) => void,
  ) {
    function Probe() {
      const scrollRef = useRef<HTMLDivElement>(null);
      const hover = useRepositoryExplorerPointerHover(scrollRef, true);
      useEffect(() => {
        onHover(hover);
      }, [hover]);
      return (
        <div ref={scrollRef}>
          {Array.from({ length: nodeCount }, (_, i) => (
            <div key={i} className="repo-tree-node" data-repo-path={`node-${i}`}>
              {i}
            </div>
          ))}
        </div>
      );
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Profiler id="probe" onRender={(_, phase, actualDuration) => onRender(phase, actualDuration)}>
          <Probe />
        </Profiler>,
      );
    });
    return container;
  }

  test("50 次高频 pointermove 只触发 1 次 React 提交（rAF 合并）", () => {
    let commitCount = 0;
    let mountCommits = 0;
    let totalDurationMs = 0;
    let hover: string | null = null;

    renderProbeWithProfiler(
      50,
      (phase, actualDuration) => {
        // React Profiler phase: "mount" | "update" | "nested-update"，全部计入提交次数。
        commitCount += 1;
        totalDurationMs += actualDuration;
        if (phase === "mount") {
          mountCommits = commitCount;
        }
      },
      (h) => {
        hover = h;
      },
    );

    expect(mountCommits).toBe(1);
    const nodes = document.querySelectorAll<HTMLElement>(".repo-tree-node");
    expect(nodes.length).toBe(50);

    // 模拟高频 pointermove：依次移过 50 个不同节点（每次都改变目标路径）。
    act(() => {
      for (let i = 0; i < 50; i++) {
        dispatchPointerMove(nodes[i]!, 10, i * 26);
      }
    });
    // flush 前 hover 不应更新（rAF 未 flush）。
    expect(hover).toBeNull();

    const beforeFlushCommits = commitCount;
    act(() => {
      flushRaf();
    });
    // flush 后 hover 更新到最后一个节点。
    expect(hover).toBe("node-49");

    const flushCommitDelta = commitCount - beforeFlushCommits;
    // 关键断言：50 次高频事件只触发 1 次 React 提交（而非 50 次）。
    expect(flushCommitDelta).toBe(1);

    // mount 后到测试结束的总提交次数：mount(1) + hover 更新(1) = 2。
    expect(commitCount - mountCommits).toBe(1);

    // 量化耗时（happy-dom 无真实 layout/paint，仅反映 React 协调+提交开销；
    // 渲染次数是确定性的、与浏览器一致的流畅度指标）。
    console.log(
      `[perf] 50 次 pointermove → ${flushCommitDelta} 次 React 提交，` +
        `总渲染耗时 ${totalDurationMs.toFixed(3)}ms（含 mount），` +
        `mount 后仅 ${commitCount - mountCommits} 次提交`,
    );
  });

  test("相同目标的重复 pointermove 至多 1 次提交（rAF 合并 + 同值优化）", () => {
    let commitCount = 0;
    let mountCommits = 0;
    let hover: string | null = null;

    renderProbeWithProfiler(
      10,
      (phase) => {
        commitCount += 1;
        if (phase === "mount") {
          mountCommits = commitCount;
        }
      },
      (h) => {
        hover = h;
      },
    );

    const nodes = document.querySelectorAll<HTMLElement>(".repo-tree-node");
    expect(mountCommits).toBe(1);

    // 先移到 node-0 并 flush。
    act(() => {
      dispatchPointerMove(nodes[0]!, 10, 0);
    });
    act(() => {
      flushRaf();
    });
    expect(hover).toBe("node-0");
    const afterFirstFlush = commitCount;

    // 之后 30 次 pointermove 仍指向 node-0（同目标）。
    act(() => {
      for (let i = 0; i < 30; i++) {
        dispatchPointerMove(nodes[0]!, 10, 0);
      }
    });
    act(() => {
      flushRaf();
    });
    expect(hover).toBe("node-0");
    // 30 次同目标事件经 rAF 合并后至多 1 次提交（同值时 React 可 bail-out 为 0），
    // 远小于 30 次——证明 rAF 合并生效。
    const sameTargetDelta = commitCount - afterFirstFlush;
    expect(sameTargetDelta).toBeLessThanOrEqual(1);

    console.log(
      `[perf] 30 次同目标 pointermove → ${sameTargetDelta} 次额外提交，` +
        `累计 ${commitCount - mountCommits} 次提交（mount 后）`,
    );
  });
});
