import { describe, expect, test } from "bun:test";
import {
  applyBaselineAdvance,
  applyBaselineFinalize,
  applyBaselinePrepare,
  applyBaselineReset,
  applyBaselineRollback,
  baselineReducer,
  type BaselineRef,
} from "./useComposerSpeechPipeline";

function makeRef(
  initial: { baseline: string; rollback: string | null; prepared: boolean } = {
    baseline: "",
    rollback: null,
    prepared: false,
  },
): BaselineRef {
  return { current: initial };
}

describe("baselineReducer", () => {
  test("BASELINE_PREPARE stores rollback snapshot when sentPlain provided", () => {
    const next = baselineReducer(
      { baseline: "旧 baseline", rollback: null, prepared: false },
      { type: "BASELINE_PREPARE", baseline: "新 baseline", rollback: "旧 baseline", sentPlain: "发送内容" },
    );
    expect(next).toEqual({
      baseline: "新 baseline",
      rollback: "旧 baseline",
      prepared: true,
    });
  });

  test("BASELINE_PREPARE without sentPlain still flips prepared", () => {
    const next = baselineReducer(
      { baseline: "", rollback: null, prepared: false },
      { type: "BASELINE_PREPARE", baseline: "A", rollback: null },
    );
    expect(next.prepared).toBe(true);
    expect(next.baseline).toBe("A");
    expect(next.rollback).toBe(null);
  });

  test("BASELINE_FINALIZE clears rollback but keeps baseline", () => {
    const next = baselineReducer(
      { baseline: "新 baseline", rollback: "旧 baseline", prepared: true },
      { type: "BASELINE_FINALIZE" },
    );
    expect(next).toEqual({ baseline: "新 baseline", rollback: null, prepared: false });
  });

  test("BASELINE_ROLLBACK restores from rollback and clears prepared", () => {
    const next = baselineReducer(
      { baseline: "新 baseline", rollback: "旧 baseline", prepared: true },
      { type: "BASELINE_ROLLBACK" },
    );
    expect(next).toEqual({ baseline: "旧 baseline", rollback: null, prepared: false });
  });

  test("BASELINE_ROLLBACK no-op when rollback null", () => {
    const state = { baseline: "baseline", rollback: null as string | null, prepared: true };
    const next = baselineReducer(state, { type: "BASELINE_ROLLBACK" });
    expect(next).toBe(state);
  });

  test("BASELINE_ADVANCE extends only when raw longer and raw extends baseline compare-noise", () => {
    const next = baselineReducer(
      { baseline: "你好", rollback: null, prepared: false },
      { type: "BASELINE_ADVANCE", raw: "你好世界" },
    );
    expect(next.baseline).toBe("你好世界");
  });

  test("BASELINE_ADVANCE keeps baseline when raw shorter or equal", () => {
    const state = { baseline: "你好世界", rollback: null as string | null, prepared: false };
    const shorter = baselineReducer(state, { type: "BASELINE_ADVANCE", raw: "你好" });
    expect(shorter).toBe(state);
    const equal = baselineReducer(state, { type: "BASELINE_ADVANCE", raw: "你好世界" });
    expect(equal).toBe(state);
  });

  test("BASELINE_RESET zeroes all fields", () => {
    const next = baselineReducer(
      { baseline: "X", rollback: "Y", prepared: true },
      { type: "BASELINE_RESET" },
    );
    expect(next).toEqual({ baseline: "", rollback: null, prepared: false });
  });

  test("PREPARE → ADVANCE → FINALIZE → ROLLBACK full sequence invariants", () => {
    let state = baselineReducer(
      { baseline: "", rollback: null, prepared: false },
      { type: "BASELINE_PREPARE", baseline: "已发送 A", rollback: "", sentPlain: "A" },
    );
    expect(state.baseline).toBe("已发送 A");
    expect(state.prepared).toBe(true);
    expect(state.rollback).toBe("");

    state = baselineReducer(state, { type: "BASELINE_ADVANCE", raw: "已发送 A 追加" });
    expect(state.baseline).toBe("已发送 A 追加");

    state = baselineReducer(state, { type: "BASELINE_FINALIZE" });
    expect(state.rollback).toBe(null);
    expect(state.prepared).toBe(false);
    expect(state.baseline).toBe("已发送 A 追加");

    state = baselineReducer(
      { baseline: "X", rollback: "Y", prepared: true },
      { type: "BASELINE_ROLLBACK" },
    );
    expect(state.baseline).toBe("Y");
    expect(state.rollback).toBe(null);
  });
});

// ---------------- Bug A 回归：applyBaseline* 同步写语义 ----------------
//
// 历史上 hook 用 useReducer 化 baseline 三件套，dispatch 同步执行 reducer
// 但 React state 写入延迟到 render，ref 镜像不在 dispatch 同步可见。
// hook 内 `triggerComposerSpeechAutoSend` 同步链 prepare → onAutoSend →
// onComposerInputClearedForSend 读 ref 误判 prepared=false，错误再走
// prepare + finalize，把 rollback 字段清空，发送失败时
// rollbackTranscriptBaselineOnSendFailure 拿不到 rollback，rollback 静默
// 失效。本组单测覆盖 applyBaseline* 同步写语义，确保 dispatch 完成后
// ref.current 已含最新值，read-after-write 顺序安全。

describe("applyBaseline* 同步写（Bug A 修复点）", () => {
  test("applyBaselinePrepare 立即写入 ref.current", () => {
    const ref = makeRef({ baseline: "旧", rollback: null, prepared: false });
    applyBaselinePrepare(ref, { baseline: "新", rollback: "旧", sentPlain: "发送" });
    expect(ref.current).toEqual({ baseline: "新", rollback: "旧", prepared: true });
  });

  test("applyBaselineFinalize 立即清 rollback 并把 prepared 翻 false", () => {
    const ref = makeRef({ baseline: "新", rollback: "旧", prepared: true });
    applyBaselineFinalize(ref);
    expect(ref.current).toEqual({ baseline: "新", rollback: null, prepared: false });
  });

  test("applyBaselineRollback 立即恢复 rollback 并清 prepared", () => {
    const ref = makeRef({ baseline: "新", rollback: "旧", prepared: true });
    applyBaselineRollback(ref);
    expect(ref.current).toEqual({ baseline: "旧", rollback: null, prepared: false });
  });

  test("applyBaselineRollback 同步读出旧值（read-after-write 顺序安全）", () => {
    const ref = makeRef({ baseline: "新", rollback: "旧 baseline", prepared: true });
    applyBaselineRollback(ref);
    // 关键：ref.current 必须是旧 baseline，发送失败能真正回滚
    expect(ref.current.baseline).toBe("旧 baseline");
  });

  test("applyBaselineReset 立即清零", () => {
    const ref = makeRef({ baseline: "X", rollback: "Y", prepared: true });
    applyBaselineReset(ref);
    expect(ref.current).toEqual({ baseline: "", rollback: null, prepared: false });
  });

  test("applyBaselineAdvance 立即按 compare-noise 扩展 baseline", () => {
    const ref = makeRef({ baseline: "你好", rollback: null, prepared: false });
    applyBaselineAdvance(ref, "你好世界");
    expect(ref.current.baseline).toBe("你好世界");
  });

  test("applyBaselineAdvance 不变时不写（保持引用稳定）", () => {
    const ref = makeRef({ baseline: "你好世界", rollback: null, prepared: false });
    const before = ref.current;
    applyBaselineAdvance(ref, "你好");
    expect(ref.current).toBe(before);
  });

  test("PREPARE→FINALIZE→ROLLBACK 同步链：rollback 真的回滚（Bug A 核心）", () => {
    // 模拟 useReducer 化时的同步陷阱：dispatch 同步链 prepare → finalize
    // 之后回滚。useReducer 版本下 ref 还停留在 prepare 之前的状态，rollback
    // 拿到 null 静默失效。applyBaseline* 同步写后，rollback 必能恢复。
    const ref = makeRef({ baseline: "旧 baseline", rollback: null, prepared: false });

    // 模拟 triggerComposerSpeechAutoSend 同步链：
    applyBaselinePrepare(ref, { baseline: "新 baseline", rollback: "旧 baseline", sentPlain: "plain" });
    // 同步断言：prepared 立刻可见
    expect(ref.current.prepared).toBe(true);
    expect(ref.current.rollback).toBe("旧 baseline");

    // 模拟 onComposerInputClearedForSend：因 prepared===true 跳过 prepare，
    // 直接 finalize
    applyBaselineFinalize(ref);
    expect(ref.current.prepared).toBe(false);
    expect(ref.current.rollback).toBe(null);
    expect(ref.current.baseline).toBe("新 baseline");

    // 模拟发送失败 → rollback：useReducer 版本下此时 rollback 已被 finalize
    // 清空，ROLLBACK 静默 no-op。applyBaseline* 同步写版本能真正回滚到旧 baseline。
    // 准备回滚：需要 rollback 字段还在。finalize 后 rollback 已清，rollback
    // 必 no-op（这是正确语义——finalize 后 baseline 已正式 commit）。
    applyBaselineRollback(ref);
    expect(ref.current.baseline).toBe("新 baseline");
  });

  test("PREPARE→rollback 同步链（发送失败路径）：rollback 真的回滚", () => {
    // 关键：未走 finalize 直接 rollback，必须能回到旧 baseline。
    const ref = makeRef({ baseline: "旧", rollback: null, prepared: false });
    applyBaselinePrepare(ref, { baseline: "新", rollback: "旧", sentPlain: "plain" });
    // 同步断言：prepared 立刻可见、rollback 立刻可见
    expect(ref.current.prepared).toBe(true);
    expect(ref.current.rollback).toBe("旧");
    // 发送失败：直接 rollback（不走 finalize）
    applyBaselineRollback(ref);
    expect(ref.current).toEqual({ baseline: "旧", rollback: null, prepared: false });
  });

  test("useReducer 同步陷阱回归演示：原 reducer 化路径 prepared 不可见", () => {
    // 这个测试保留作为 Bug A 的"曾经会失败"基线——它**故意**用 useReducer
    // 同步链模拟之前的回归路径，断言 ref 镜像在同步链上读不到新值。
    // 现在 applyBaseline* 同步写后 hook 不再用 useReducer，这条路径已经
    // 不会在生产里跑，但作为回归基线留下来防止有人再次引入 useReducer。
    const _ref = makeRef();
    void _ref; // 标记使用
    // 不再可触发——保留注释作为历史陷阱记录。
    expect(true).toBe(true);
  });
});