import { describe, expect, test } from "bun:test";
import type { SessionLinkRecord } from "../types/sessionLink";
import { filterSessionLinkRecords } from "./sessionLinkFilters";

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
