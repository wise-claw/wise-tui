import { describe, expect, test } from "bun:test";
import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../../services/assistantPromptLayers";

function cockpitSubModeFromEntry(
  hasInitialTarget: boolean,
  initialAssistantId?: string | null,
) {
  const assistantId = initialAssistantId?.trim();
  if (assistantId) {
    return { kind: "conversation" as const, assistantId };
  }
  if (hasInitialTarget) {
    return { kind: "conversation" as const, assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID };
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
});
