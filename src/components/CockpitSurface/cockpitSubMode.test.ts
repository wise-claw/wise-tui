import { describe, expect, test } from "bun:test";

function cockpitSubModeFromEntry(
  hasInitialTarget: boolean,
  initialAssistantId?: string | null,
) {
  const assistantId = initialAssistantId?.trim();
  if (assistantId) {
    return { kind: "conversation" as const, assistantId };
  }
  if (hasInitialTarget) {
    return { kind: "hub" as const };
  }
  return { kind: "hub" as const };
}

describe("cockpitSubModeFromEntry", () => {
  test("prefers explicit assistant id over hub", () => {
    expect(cockpitSubModeFromEntry(false, "custom:writer")).toEqual({
      kind: "conversation",
      assistantId: "custom:writer",
    });
  });

  test("stale initial id must be cleared before hub re-selection", () => {
    const staleInitial = "custom:release-notes";
    const hubSelection = "custom:code-review";
    expect(cockpitSubModeFromEntry(false, staleInitial).assistantId).toBe(staleInitial);
    expect(cockpitSubModeFromEntry(false, null)).toEqual({ kind: "hub" });
    expect(cockpitSubModeFromEntry(false, hubSelection).assistantId).toBe(hubSelection);
  });

  test("initial target without assistant id opens hub", () => {
    expect(cockpitSubModeFromEntry(true, null)).toEqual({ kind: "hub" });
  });
});
