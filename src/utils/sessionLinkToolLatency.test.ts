import { describe, expect, test } from "bun:test";
import type { SessionLinkRecord } from "../types/sessionLink";
import {
  analyzeSessionLinkToolLatency,
  computeToolLatencySamples,
  detectDuplicateReadPaths,
  extractToolTargetPathFromDetail,
} from "./sessionLinkToolLatency";

function toolUse(id: string, turn: number, ts: number, name: string, detail?: string): SessionLinkRecord {
  return {
    id: `u-${id}`,
    timestampMs: ts,
    layer: "tool",
    kind: "tool_use",
    turnIndex: turn,
    summary: name,
    detail,
    observed: true,
    source: "memory",
    toolUseId: id,
  };
}

function toolResult(id: string, turn: number, ts: number): SessionLinkRecord {
  return {
    id: `r-${id}`,
    timestampMs: ts,
    layer: "tool",
    kind: "tool_result",
    turnIndex: turn,
    summary: "result",
    observed: true,
    source: "memory",
    toolUseId: id,
  };
}

describe("sessionLinkToolLatency", () => {
  test("extractToolTargetPathFromDetail parses Read file_path", () => {
    const path = extractToolTargetPathFromDetail('input:\n{"file_path":"src/foo.ts"}');
    expect(path).toBe("src/foo.ts");
  });

  test("computeToolLatencySamples pairs use/result by toolUseId", () => {
    const records = [
      toolUse("t1", 1, 1000, "Bash"),
      toolResult("t1", 1, 4500),
      toolUse("t2", 1, 5000, "Read", 'input:\n{"file_path":"a.ts"}'),
      toolResult("t2", 1, 7000),
    ];
    const samples = computeToolLatencySamples(records);
    expect(samples).toHaveLength(2);
    expect(samples.find((s) => s.name === "Bash")?.durationMs).toBe(3500);
  });

  test("detectDuplicateReadPaths finds repeated paths", () => {
    const detail = 'input:\n{"file_path":"src/shared.ts"}';
    const records = [
      toolUse("a", 1, 100, "Read", detail),
      toolResult("a", 1, 200),
      toolUse("b", 2, 300, "Read", detail),
      toolResult("b", 2, 400),
      toolUse("c", 3, 500, "Read", detail),
      toolResult("c", 3, 600),
    ];
    const dupes = detectDuplicateReadPaths(records);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.path).toBe("src/shared.ts");
    expect(dupes[0]?.count).toBe(3);
  });

  test("analyzeSessionLinkToolLatency aggregates hotspots", () => {
    const records = [
      toolUse("t1", 1, 0, "Shell"),
      toolResult("t1", 1, 12_000),
      toolUse("t2", 2, 20_000, "Shell"),
      toolResult("t2", 2, 35_000),
    ];
    const { hotspots } = analyzeSessionLinkToolLatency(records);
    expect(hotspots[0]?.name).toBe("Shell");
    expect(hotspots[0]?.count).toBe(2);
    expect((hotspots[0]?.p95DurationMs ?? 0) >= 10_000).toBe(true);
  });
});
