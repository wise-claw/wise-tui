import { describe, expect, test } from "bun:test";
import { evaluateManualSegmentIdle } from "./composerSpeechSegmentIdle";

const BASE = {
  sendMode: "manual" as const,
  lastSeenText: "",
  segmentTriggerActed: false,
  listening: true,
  idleMs: 1000,
  now: 0,
  armedAt: null as number | null,
};

describe("evaluateManualSegmentIdle", () => {
  test("非 manual 模式直接不触发", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      sendMode: "silenceAutoSend",
      trimmed: "你好",
    });
    expect(d.shouldArm).toBe(false);
    expect(d.shouldFire).toBe(false);
  });

  test("空文本不触发", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "",
    });
    expect(d.shouldArm).toBe(false);
  });

  test("文本与上次相同不触发（防止 ASR cumulative 重灌重启）", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      lastSeenText: "你好",
      trimmed: "你好",
    });
    expect(d.shouldArm).toBe(false);
  });

  test("已被收尾词触发的段不再触发", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      segmentTriggerActed: true,
      trimmed: "你好",
    });
    expect(d.shouldArm).toBe(false);
  });

  test("首次出现的文本触发 arming", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "你好",
    });
    expect(d.shouldArm).toBe(true);
    expect(d.shouldFire).toBe(false);
  });

  test("1s 后到达仍 listening 时触发 fire", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "你好",
      armedAt: 0,
      now: 1000,
    });
    expect(d.shouldArm).toBe(false);
    expect(d.shouldFire).toBe(true);
  });

  test("1s 内未到期则继续 arming（不 fire）", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "你好",
      armedAt: 0,
      now: 500,
    });
    expect(d.shouldArm).toBe(true);
    expect(d.shouldFire).toBe(false);
  });

  test("到期但已停止 listening 则不 fire", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "你好",
      armedAt: 0,
      now: 1000,
      listening: false,
    });
    expect(d.shouldFire).toBe(false);
  });

  test("到期但已被收尾词触发过则不 fire", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      trimmed: "你好",
      armedAt: 0,
      now: 1000,
      segmentTriggerActed: true,
    });
    expect(d.shouldFire).toBe(false);
  });

  test("自定义 idleMs=2500：1250ms 时仍 arming", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      idleMs: 2500,
      trimmed: "你好",
      armedAt: 0,
      now: 1250,
    });
    expect(d.shouldArm).toBe(true);
    expect(d.shouldFire).toBe(false);
  });

  test("自定义 idleMs=2500：到达 2500ms 时 fire", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      idleMs: 2500,
      trimmed: "你好",
      armedAt: 0,
      now: 2500,
    });
    expect(d.shouldArm).toBe(false);
    expect(d.shouldFire).toBe(true);
  });

  test("自定义 idleMs=2500：仅到 2000ms 不 fire", () => {
    const d = evaluateManualSegmentIdle({
      ...BASE,
      idleMs: 2500,
      trimmed: "你好",
      armedAt: 0,
      now: 2000,
    });
    expect(d.shouldFire).toBe(false);
  });
});