import { describe, expect, test } from "bun:test";
import {
  formatSilenceAutoSendIdleSeconds,
  normalizeManualSegmentIdleMs,
  normalizeSilenceAutoSendIdleMs,
} from "./composerSpeechSilenceIdle";

describe("composerSpeechSilenceIdle", () => {
  test("normalizeSilenceAutoSendIdleMs clamps and steps", () => {
    expect(normalizeSilenceAutoSendIdleMs(1234)).toBe(1200);
    expect(normalizeSilenceAutoSendIdleMs(undefined)).toBe(1000);
    expect(normalizeSilenceAutoSendIdleMs(50)).toBe(400);
    expect(normalizeSilenceAutoSendIdleMs(99_999)).toBe(10_000);
    expect(normalizeSilenceAutoSendIdleMs("abc")).toBe(1000);
  });

  test("normalizeManualSegmentIdleMs clamps and steps", () => {
    expect(normalizeManualSegmentIdleMs(1234)).toBe(1200);
    expect(normalizeManualSegmentIdleMs(undefined)).toBe(1000);
    expect(normalizeManualSegmentIdleMs(50)).toBe(400);
    expect(normalizeManualSegmentIdleMs(99_999)).toBe(10_000);
    expect(normalizeManualSegmentIdleMs("abc")).toBe(1000);
    expect(normalizeManualSegmentIdleMs(2500)).toBe(2500);
  });

  test("formatSilenceAutoSendIdleSeconds", () => {
    expect(formatSilenceAutoSendIdleSeconds(1500)).toBe("1.5");
    expect(formatSilenceAutoSendIdleSeconds(2000)).toBe("2");
    expect(formatSilenceAutoSendIdleSeconds(2500)).toBe("2.5");
    expect(formatSilenceAutoSendIdleSeconds(1000)).toBe("1");
  });
});
