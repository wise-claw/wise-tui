import { describe, expect, test } from "bun:test";
import {
  modelProfileEngineLabel,
  normalizeModelProfileEngine,
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
