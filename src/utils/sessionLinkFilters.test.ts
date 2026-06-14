import { describe, expect, test } from "bun:test";
import type { SessionLinkRecord } from "../types/sessionLink";
import {
  deriveTimestampRangeFromTurnMetrics,
  filterSessionLinkRecords,
  filterSessionLinkRecordsByTurnRange,
  filterTurnMetricsByTurnRange,
  type SessionLinkTurnMetric,
} from "./sessionLinkFilters";

const sample: SessionLinkRecord[] = [
  {
    id: "1",
    timestampMs: 1,
    layer: "input",
    kind: "user_input",
    turnIndex: 1,
    summary: "hello",
    observed: true,
    source: "memory",
  },
  {
    id: "2",
    timestampMs: 2,
    layer: "http",
    kind: "api_request",
    turnIndex: 1,
    summary: "inferred",
    observed: false,
    source: "inferred",
  },
  {
    id: "3",
    timestampMs: 3,
    layer: "tool",
    kind: "tool_use",
    turnIndex: 1,
    summary: "Bash",
    observed: true,
    source: "memory",
  },
];

describe("filterSessionLinkRecords", () => {
  test("http filter", () => {
    expect(filterSessionLinkRecords(sample, "http")).toHaveLength(1);
  });
  test("inferred_http filter", () => {
    expect(filterSessionLinkRecords(sample, "inferred_http")[0]?.kind).toBe("api_request");
  });
});

const multiTurnSample: SessionLinkRecord[] = [
  {
    id: "t1-input",
    timestampMs: 1000,
    layer: "input",
    kind: "user_input",
    turnIndex: 1,
    summary: "hello",
    observed: true,
    source: "memory",
  },
  {
    id: "t1-tool",
    timestampMs: 1500,
    layer: "tool",
    kind: "tool_use",
    turnIndex: 1,
    summary: "Bash",
    observed: true,
    source: "memory",
  },
  {
    id: "t2-input",
    timestampMs: 2000,
    layer: "input",
    kind: "user_input",
    turnIndex: 2,
    summary: "again",
    observed: true,
    source: "memory",
  },
  {
    id: "t2-http",
    timestampMs: 2500,
    layer: "http",
    kind: "api_request",
    turnIndex: 2,
    summary: "200",
    observed: true,
    source: "memory",
  },
  {
    id: "t3-input",
    timestampMs: 3000,
    layer: "input",
    kind: "user_input",
    turnIndex: 3,
    summary: "third",
    observed: true,
    source: "memory",
  },
];

const multiTurnMetrics: SessionLinkTurnMetric[] = [
  { turnIndex: 1, startMs: 1000, endMs: 1500, durationMs: 500, inputCount: 1, toolCount: 1, httpObserved: 0, httpInferred: 0 },
  { turnIndex: 2, startMs: 2000, endMs: 2500, durationMs: 500, inputCount: 1, toolCount: 0, httpObserved: 1, httpInferred: 0 },
  { turnIndex: 3, startMs: 3000, endMs: 3000, durationMs: 0, inputCount: 1, toolCount: 0, httpObserved: 0, httpInferred: 0 },
];

describe("filterSessionLinkRecordsByTurnRange", () => {
  test("null range returns a copy of all records", () => {
    const out = filterSessionLinkRecordsByTurnRange(multiTurnSample, null);
    expect(out.length).toBe(multiTurnSample.length);
    expect(out).not.toBe(multiTurnSample);
  });
  test("inclusive range keeps only matching turns", () => {
    const out = filterSessionLinkRecordsByTurnRange(multiTurnSample, { fromTurn: 2, toTurn: 3 });
    expect(out.map((r) => r.turnIndex)).toEqual([2, 2, 3]);
  });
  test("single turn", () => {
    const out = filterSessionLinkRecordsByTurnRange(multiTurnSample, { fromTurn: 1, toTurn: 1 });
    expect(out.every((r) => r.turnIndex === 1)).toBe(true);
    expect(out).toHaveLength(2);
  });
  test("inverted / invalid range yields empty", () => {
    expect(
      filterSessionLinkRecordsByTurnRange(multiTurnSample, { fromTurn: 3, toTurn: 1 }),
    ).toEqual([]);
    expect(
      filterSessionLinkRecordsByTurnRange(multiTurnSample, { fromTurn: 0, toTurn: 0 }),
    ).toEqual([]);
  });
});

describe("filterTurnMetricsByTurnRange", () => {
  test("null returns copy", () => {
    const out = filterTurnMetricsByTurnRange(multiTurnMetrics, null);
    expect(out).toEqual(multiTurnMetrics);
    expect(out).not.toBe(multiTurnMetrics);
  });
  test("inclusive range", () => {
    expect(
      filterTurnMetricsByTurnRange(multiTurnMetrics, { fromTurn: 2, toTurn: 3 }).map((m) => m.turnIndex),
    ).toEqual([2, 3]);
  });
  test("invalid range yields empty", () => {
    expect(
      filterTurnMetricsByTurnRange(multiTurnMetrics, { fromTurn: 3, toTurn: 2 }),
    ).toEqual([]);
  });
});

describe("deriveTimestampRangeFromTurnMetrics", () => {
  test("null range -> null", () => {
    expect(deriveTimestampRangeFromTurnMetrics(multiTurnMetrics, null)).toBeNull();
  });
  test("range covering 2-3 picks min/max", () => {
    expect(
      deriveTimestampRangeFromTurnMetrics(multiTurnMetrics, { fromTurn: 2, toTurn: 3 }),
    ).toEqual({ startMs: 2000, endMs: 3000 });
  });
  test("range with no metric match -> null", () => {
    expect(
      deriveTimestampRangeFromTurnMetrics(multiTurnMetrics, { fromTurn: 9, toTurn: 10 }),
    ).toBeNull();
  });
  test("inverted range -> null", () => {
    expect(
      deriveTimestampRangeFromTurnMetrics(multiTurnMetrics, { fromTurn: 3, toTurn: 1 }),
    ).toBeNull();
  });
});
