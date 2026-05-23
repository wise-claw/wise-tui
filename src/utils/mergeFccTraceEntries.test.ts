import { describe, expect, test } from "bun:test";
import type { FccTraceEntry } from "../types/fccTrace";
import { mergeFccTraceEntries } from "./mergeFccTraceEntries";

function row(id: string, timestampMs: number): FccTraceEntry {
  return {
    id,
    timestampMs,
    method: "POST",
    path: "/v1/messages",
  };
}

describe("mergeFccTraceEntries", () => {
  test("sorts by timestamp descending and dedupes by id", () => {
    const merged = mergeFccTraceEntries(
      [row("a", 100), row("b", 200)],
      [row("b", 250), row("c", 50)],
    );
    expect(merged.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(merged[0]?.timestampMs).toBe(250);
  });
});
