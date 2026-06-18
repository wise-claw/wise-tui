import { describe, expect, test } from "bun:test";
import { resolveOpencodeExecModelId } from "./opencodeModel";

describe("resolveOpencodeExecModelId", () => {
  test("prefers active OpenCode profile model", () => {
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "anthropic/claude-sonnet-4",
        contextExecutionEngine: "claude",
        store: {
          profiles: [],
          activeProfileId: null,
          activeCodexProfileId: null,
          activeOpencodeProfileId: "oc-1",
          effectiveModel: null,
          effectiveCodexModel: null,
          effectiveOpencodeModel: "opencode/grok-code",
        },
      }),
    ).toBe("opencode/grok-code");
  });

  test("falls back to session model only in OpenCode context", () => {
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "google/gemini-2.5-pro",
        contextExecutionEngine: "opencode",
        store: null,
      }),
    ).toBe("google/gemini-2.5-pro");
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "google/gemini-2.5-pro",
        contextExecutionEngine: "claude",
        store: null,
      }),
    ).toBeUndefined();
  });
});
