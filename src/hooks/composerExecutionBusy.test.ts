import { describe, expect, test } from "bun:test";
import {
  computeComposerExecutionBusy,
  shouldShowStopButton,
  type ComposerExecutionBusyInput,
} from "./composerExecutionBusy";

const baseInput: ComposerExecutionBusyInput = {
  sessionStatus: "idle",
  backgroundContextCompactInFlight: false,
  pendingExecutionTaskCount: 0,
};

describe("computeComposerExecutionBusy", () => {
  test("status=running 直接命中 status", () => {
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: "running" }),
    ).toEqual({ isBusy: true, source: "status" });
  });

  test("status=connecting 视同 running", () => {
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: "connecting" }),
    ).toEqual({ isBusy: true, source: "status" });
  });

  test("status=idle + pending>0 命中 pending（覆盖队首接力未切状态）", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        pendingExecutionTaskCount: 1,
      }),
    ).toEqual({ isBusy: true, source: "pending" });
  });

  test("status=idle + compact in-flight 命中 compact（覆盖 finally 翻 false 之前）", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        backgroundContextCompactInFlight: true,
      }),
    ).toEqual({ isBusy: true, source: "compact" });
  });

  test("status=idle + pending=0 + compact=false + resident=true 命中 resident（streaming 长驻）", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        streamingResident: true,
      }),
    ).toEqual({ isBusy: true, source: "resident" });
  });

  test("status=completed/cancelled/error/无状态 + 无任何信号 → none", () => {
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: "completed" }),
    ).toEqual({ isBusy: false, source: "none" });
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: "cancelled" }),
    ).toEqual({ isBusy: false, source: "none" });
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: "error" }),
    ).toEqual({ isBusy: false, source: "none" });
    expect(
      computeComposerExecutionBusy({ ...baseInput, sessionStatus: undefined }),
    ).toEqual({ isBusy: false, source: "none" });
  });

  test("优先级：status=running + compact=true + pending=3 → source=status", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "running",
        backgroundContextCompactInFlight: true,
        pendingExecutionTaskCount: 3,
      }),
    ).toEqual({ isBusy: true, source: "status" });
  });

  test("优先级：compact=true + pending=2 + resident=true → source=compact", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        backgroundContextCompactInFlight: true,
        pendingExecutionTaskCount: 2,
        streamingResident: true,
      }),
    ).toEqual({ isBusy: true, source: "compact" });
  });

  test("优先级：status=idle + compact=false + pending=2 + resident=true → source=pending（覆盖队首接力）", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        backgroundContextCompactInFlight: false,
        pendingExecutionTaskCount: 2,
        streamingResident: true,
      }),
    ).toEqual({ isBusy: true, source: "pending" });
  });

  test("边界：status=completed + compact=true → source=compact（status 已结束但压缩 turn 仍在跑）", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "completed",
        backgroundContextCompactInFlight: true,
      }),
    ).toEqual({ isBusy: true, source: "compact" });
  });

  test("streamingResident=undefined 不触发 resident 分支", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        streamingResident: undefined,
      }),
    ).toEqual({ isBusy: false, source: "none" });
  });

  test("streamingResident=false 显式不命中 resident", () => {
    expect(
      computeComposerExecutionBusy({
        ...baseInput,
        sessionStatus: "idle",
        streamingResident: false,
      }),
    ).toEqual({ isBusy: false, source: "none" });
  });
});

describe("shouldShowStopButton", () => {
  const busy = { isBusy: true, source: "status" as const };
  const idle = { isBusy: false, source: "none" as const };

  test("busy=false 时不显示", () => {
    expect(shouldShowStopButton(idle, true)).toBe(false);
    expect(shouldShowStopButton(idle, false)).toBe(false);
  });

  test("busy=true 且 hasOnCancel=false 时不显示（父组件未传 onCancel）", () => {
    expect(shouldShowStopButton(busy, false)).toBe(false);
  });

  test("busy=true 且 hasOnCancel=true 时显示", () => {
    expect(shouldShowStopButton(busy, true)).toBe(true);
  });
});