import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveClaudeExecModelId, resolveClaudeProfileModelFromStore } from "./claudeModel";

const store = (partial: Partial<ClaudeModelProfileStoreView>): ClaudeModelProfileStoreView =>
  ({
    profiles: [],
    activeProfileId: "claude-1",
    activeCodexProfileId: null,
    activeOpencodeProfileId: null,
    effectiveModel: "glm-5",
    effectiveCodexModel: null,
    effectiveOpencodeModel: null,
    ...partial,
  }) as ClaudeModelProfileStoreView;

describe("resolveClaudeProfileModelFromStore", () => {
  test("prefers effectiveModel", () => {
    expect(resolveClaudeProfileModelFromStore(store({}))).toBe("glm-5");
  });

  test("falls back to active claude profile modelId", () => {
    expect(
      resolveClaudeProfileModelFromStore(
        store({
          effectiveModel: null,
          profiles: [
            {
              id: "claude-1",
              company: "Zhipu",
              name: "GLM",
              modelId: "glm-4.7",
              settingsJson: "{}",
              engine: "claude",
              createdAtMs: 0,
              updatedAtMs: 0,
            },
          ],
        }),
      ),
    ).toBe("glm-4.7");
  });
});

describe("resolveClaudeExecModelId", () => {
  test("prefers profile model over stale session.model", () => {
    expect(
      resolveClaudeExecModelId({
        sessionModel: "sonnet",
        store: store({ effectiveModel: "glm-5" }),
      }),
    ).toBe("glm-5");
  });

  test("falls back to session model when profile is empty", () => {
    expect(
      resolveClaudeExecModelId({
        sessionModel: "opus",
        store: store({ effectiveModel: null, profiles: [] }),
      }),
    ).toBe("opus");
  });
});
