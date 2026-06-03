import { describe, expect, it } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  formatModelProfileDisplayLabel,
  resolveActiveModelProfileDisplayLabel,
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
