import { describe, expect, test } from "bun:test";
import {
  buildOptimisticApplyStoreView,
  extractEffectiveModelsFromStore,
  modelProfileEngineLabel,
  normalizeModelProfileEngine,
  pickBadgeEffectiveModel,
  resolveActiveModelProfileId,
  resolveEffectiveModelForProfileEngine,
  type ClaudeModelProfileStoreView,
} from "./claudeModelProfile";

const store: ClaudeModelProfileStoreView = {
  profiles: [],
  activeProfileId: "claude-1",
  activeCodexProfileId: "codex-1",
  activeOpencodeProfileId: "oc-1",
  effectiveModel: "claude-sonnet",
  effectiveCodexModel: "gpt-5.4",
  effectiveOpencodeModel: "minimax/MiniMax-M2.7-highspeed",
};

describe("normalizeModelProfileEngine", () => {
  test("recognizes opencode", () => {
    expect(normalizeModelProfileEngine("opencode")).toBe("opencode");
    expect(normalizeModelProfileEngine("OpenCode")).toBe("opencode");
  });
});

describe("resolveActiveModelProfileId", () => {
  test("returns engine-specific active profile id", () => {
    expect(resolveActiveModelProfileId("claude", store)).toBe("claude-1");
    expect(resolveActiveModelProfileId("codex", store)).toBe("codex-1");
    expect(resolveActiveModelProfileId("opencode", store)).toBe("oc-1");
  });
});

describe("resolveEffectiveModelForProfileEngine", () => {
  test("returns engine-specific effective model", () => {
    expect(resolveEffectiveModelForProfileEngine("opencode", store)).toBe(
      "minimax/MiniMax-M2.7-highspeed",
    );
  });
});

describe("modelProfileEngineLabel", () => {
  test("labels opencode", () => {
    expect(modelProfileEngineLabel("opencode")).toBe("OpenCode");
  });
});

describe("extractEffectiveModelsFromStore", () => {
  test("maps store effective fields", () => {
    expect(extractEffectiveModelsFromStore(store)).toEqual({
      effectiveModel: "claude-sonnet",
      effectiveCodexModel: "gpt-5.4",
      effectiveOpencodeModel: "minimax/MiniMax-M2.7-highspeed",
    });
  });
});

describe("pickBadgeEffectiveModel", () => {
  test("prefers claude then codex then opencode", () => {
    expect(pickBadgeEffectiveModel(store)).toBe("claude-sonnet");
    expect(
      pickBadgeEffectiveModel({
        effectiveModel: null,
        effectiveCodexModel: "gpt-5.4",
        effectiveOpencodeModel: "minimax/x",
      }),
    ).toBe("gpt-5.4");
  });
});

describe("buildOptimisticApplyStoreView", () => {
  const profilesStore: ClaudeModelProfileStoreView = {
    ...store,
    profiles: [
      {
        id: "oc-2",
        company: "MiniMax",
        name: "M2.7",
        modelId: "minimax/M2.7",
        settingsJson: "{}",
        engine: "opencode",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
  };

  test("updates opencode active and effective", () => {
    const next = buildOptimisticApplyStoreView(profilesStore, "oc-2");
    expect(next?.activeOpencodeProfileId).toBe("oc-2");
    expect(next?.effectiveOpencodeModel).toBe("minimax/M2.7");
    expect(next?.activeProfileId).toBe("claude-1");
  });

  test("returns null for unknown profile", () => {
    expect(buildOptimisticApplyStoreView(profilesStore, "missing")).toBeNull();
  });
});
