import { describe, expect, test } from "bun:test";
import {
  formatHttpTraceTimestampCompact,
  formatHttpTraceTimestampFull,
} from "./formatHttpTraceTimestamp";

describe("formatHttpTraceTimestamp", () => {
  test("compact includes milliseconds", () => {
    const ts = Date.UTC(2026, 5, 10, 11, 36, 15, 432);
    expect(formatHttpTraceTimestampCompact(ts)).toMatch(/36:15\.432$/);
  });

  test("full uses ISO-like local datetime with ms", () => {
    const ts = new Date(2026, 5, 10, 19, 36, 15, 432).getTime();
    expect(formatHttpTraceTimestampFull(ts)).toBe("2026-06-10 19:36:15.432");
  });
});
