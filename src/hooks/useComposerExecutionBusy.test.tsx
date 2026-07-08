import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { useLayoutEffect, useState } from "react";
import {
  COMPOSER_EXECUTION_BUSY_STICKY_RELEASE_MS,
  useComposerExecutionBusy,
  type ComposerExecutionBusyHookInput,
} from "./useComposerExecutionBusy";
import type { ComposerBusyResult } from "./composerExecutionBusy";

interface Harness {
  get latest(): ComposerBusyResult;
  set(input: Partial<ComposerExecutionBusyHookInput>): void;
  unmount(): void;
}

function makeHarness(): Harness {
  let latest: ComposerBusyResult | null = null;
  const setterRef: { current: ((input: Partial<ComposerExecutionBusyHookInput>) => void) | null } = {
    current: null,
  };
  let renderer: ReturnType<typeof create> | undefined;

  function Probe() {
    const [override, setOverride] = useState<Partial<ComposerExecutionBusyHookInput>>({});
    setterRef.current = (next) => setOverride(next);
    const base: ComposerExecutionBusyHookInput = {
      sessionStatus: "idle",
      backgroundContextCompactInFlight: false,
      pendingExecutionTaskCount: 0,
    };
    const busy = useComposerExecutionBusy({ ...base, ...override });
    useLayoutEffect(() => {
      latest = busy;
    });
    return null;
  }

  act(() => {
    renderer = create(<Probe />);
  });
  if (!latest) throw new Error("Probe never received a value");
  if (!setterRef.current) throw new Error("setter not ready");

  return {
    get latest() {
      if (!latest) throw new Error("latest not ready");
      return latest;
    },
    set: (input) => {
      if (!setterRef.current) throw new Error("setter not ready");
      act(() => {
        setterRef.current?.(input);
      });
    },
    unmount: () => renderer?.unmount(),
  };
}

describe("useComposerExecutionBusy sticky 行为", () => {
  test("raw 翻 false 后 sticky 立即维持 busy=true", () => {
    const harness = makeHarness();
    harness.set({ sessionStatus: "running" });
    expect(harness.latest).toEqual({ isBusy: true, source: "status" });

    // raw 翻 false，sticky 立即维持 busy=true，source 保留上一次的值
    harness.set({ sessionStatus: "idle" });
    expect(harness.latest.isBusy).toBe(true);
    expect(harness.latest.source).toBe("status");
    harness.unmount();
  });

  test("sticky 期间 raw 仍为 busy：source 跟随最新 raw 更新", () => {
    const harness = makeHarness();
    harness.set({ sessionStatus: "running" });
    expect(harness.latest).toEqual({ isBusy: true, source: "status" });

    // sticky busy=true 期间 raw 翻成 pending=1，source 应跟随 raw 更新（status → pending）
    harness.set({ sessionStatus: "idle", pendingExecutionTaskCount: 1 });
    expect(harness.latest.isBusy).toBe(true);
    expect(harness.latest.source).toBe("pending");
    harness.unmount();
  });

  test("raw 在 sticky 窗口内翻 false：sticky 维持 busy=true", () => {
    const harness = makeHarness();
    harness.set({ sessionStatus: "running" });
    expect(harness.latest).toEqual({ isBusy: true, source: "status" });

    // raw 翻成 idle + pending=1（仍然 busy），source 应更新到 pending
    harness.set({ sessionStatus: "idle", pendingExecutionTaskCount: 1 });
    expect(harness.latest.isBusy).toBe(true);
    expect(harness.latest.source).toBe("pending");

    // raw 翻 false，sticky 维持 busy=true 直到 STICKY_RELEASE_MS
    harness.set({ sessionStatus: "idle", pendingExecutionTaskCount: 0 });
    expect(harness.latest.isBusy).toBe(true);
    expect(harness.latest.source).toBe("pending");
    harness.unmount();
  });

  test("sticky 窗口结束后释放 busy=false 并触发重渲染", async () => {
    const harness = makeHarness();
    harness.set({ sessionStatus: "running" });
    expect(harness.latest).toEqual({ isBusy: true, source: "status" });

    harness.set({ sessionStatus: "idle" });
    // sticky 窗口内仍维持 busy=true
    expect(harness.latest.isBusy).toBe(true);

    // 等过 STICKY_RELEASE_MS：release timer 主动触发重渲染，isBusy 翻 false（按钮应消失）。
    // 回归「点两次才响应」：ref 变更不触发渲染时，按钮会卡在显示态直到下一次外部渲染。
    await act(async () => {
      await new Promise((r) =>
        setTimeout(r, COMPOSER_EXECUTION_BUSY_STICKY_RELEASE_MS + 50),
      );
    });
    expect(harness.latest.isBusy).toBe(false);
    expect(harness.latest.source).toBe("none");
    harness.unmount();
  });
});