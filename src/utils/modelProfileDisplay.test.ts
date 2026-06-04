import { describe, expect, it } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  formatModelProfileComposerBarLabel,
  formatModelProfileDropdownLabel,
  formatModelProfileDisplayLabel,
  resolveActiveModelProfileComposerBarLabel,
  resolveActiveModelProfileDisplayLabel,
  resolveModelProfileDropdownParts,
} from "./modelProfileDisplay.ts";

describe("formatModelProfileDisplayLabel", () => {
  it("prefers configured name over formatted modelId", () => {
    expect(
      formatModelProfileDisplayLabel({ name: "glm5.1", modelId: "glm" }),
    ).toBe("glm5.1");
  });

  it("falls back to formatted modelId when name is empty", () => {
    expect(formatModelProfileDisplayLabel({ name: "", modelId: "glm" })).toBe(
      "Glm",
    );
  });
});

describe("resolveActiveModelProfileDisplayLabel", () => {
  const store: ClaudeModelProfileStoreView = {
    profiles: [
      {
        id: "p1",
        company: "火山",
        name: "glm5.1",
        modelId: "glm",
        settingsJson: "{}",
        engine: "claude",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    activeProfileId: "p1",
    activeCodexProfileId: null,
    activeOpencodeProfileId: null,
    effectiveModel: "glm",
    effectiveCodexModel: null,
    effectiveOpencodeModel: null,
  };

  it("uses active profile name for claude engine", () => {
    expect(resolveActiveModelProfileDisplayLabel("claude", store)).toBe(
      "glm5.1",
    );
  });
});

describe("resolveActiveModelProfileComposerBarLabel", () => {
  const store: ClaudeModelProfileStoreView = {
    profiles: [
      {
        id: "p1",
        company: "火山",
        name: "glm5.1",
        modelId: "glm",
        settingsJson: "{}",
        engine: "claude",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    activeProfileId: "p1",
    activeCodexProfileId: null,
    activeOpencodeProfileId: null,
    effectiveModel: "glm",
    effectiveCodexModel: null,
    effectiveOpencodeModel: null,
  };

  it("includes company prefix like model switcher list", () => {
    expect(resolveActiveModelProfileComposerBarLabel("claude", store)).toBe(
      "火山 glm5.1",
    );
  });
});

describe("formatModelProfileComposerBarLabel", () => {
  it("does not duplicate when company equals display name", () => {
    expect(
      formatModelProfileComposerBarLabel({
        company: "Free",
        name: "Free",
        modelId: "free",
      }),
    ).toBe("Free");
  });
});

describe("formatModelProfileDropdownLabel", () => {
  it("always includes company and model name", () => {
    expect(
      formatModelProfileDropdownLabel({
        company: "火山",
        name: "glm5.1",
        modelId: "glm",
      }),
    ).toBe("火山 glm5.1");
  });

  it("uses modelId when name equals company", () => {
    expect(
      formatModelProfileDropdownLabel({
        company: "百炼",
        name: "百炼",
        modelId: "qwen3.7-max",
      }),
    ).toBe("百炼 Qwen3.7");
  });

  it("uses modelId when only company is configured", () => {
    expect(
      formatModelProfileDropdownLabel({
        company: "百炼",
        name: "",
        modelId: "qwen3.6",
      }),
    ).toBe("百炼 Qwen3.6");
  });

  it("strips redundant company prefix from model name", () => {
    expect(
      resolveModelProfileDropdownParts({
        company: "Bailian",
        name: "Bailian-qwen3.6",
        modelId: "qwen3.6",
      }),
    ).toEqual({ company: "Bailian", modelName: "qwen3.6" });
  });

  it("avoids duplicate when name matches company case-insensitively", () => {
    expect(
      resolveModelProfileDropdownParts({
        company: "MiniMax",
        name: "Minimax",
        modelId: "minimax-m2",
      }).modelName,
    ).toBe("Minimax");
  });
});
