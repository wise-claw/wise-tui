import { describe, expect, test } from "bun:test";
import {
  formatSilenceAutoSendIdleSeconds,
  normalizeSilenceAutoSendIdleMs,
} from "./composerSpeechSilenceIdle";

describe("composerSpeechSilenceIdle", () => {
  test("normalizeSilenceAutoSendIdleMs clamps and steps", () => {
    expect(normalizeSilenceAutoSendIdleMs(1234)).toBe(1200);
    expect(normalizeSilenceAutoSendIdleMs(undefined)).toBe(1000);
    expect(normalizeSilenceAutoSendIdleMs(50)).toBe(400);
  });

  test("formatSilenceAutoSendIdleSeconds", () => {
    expect(formatSilenceAutoSendIdleSeconds(1500)).toBe("1.5");
    expect(formatSilenceAutoSendIdleSeconds(2000)).toBe("2");
  });
});
