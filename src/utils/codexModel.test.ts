import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  resolveCodexContextExecutionEngine,
  resolveCodexExecModelId,
  resolveCodexProfileModelFromStore,
} from "./codexModel";

const store = (partial: Partial<ClaudeModelProfileStoreView>): ClaudeModelProfileStoreView =>
  ({
    profiles: [],
    activeProfileId: null,
    activeCodexProfileId: "codex-1",
    activeOpencodeProfileId: null,
    effectiveModel: "Qwen3.7",
    effectiveCodexModel: "Qwen3.5-codex",
    effectiveOpencodeModel: null,
    ...partial,
  }) as ClaudeModelProfileStoreView;

describe("resolveCodexProfileModelFromStore", () => {
  test("prefers effectiveCodexModel", () => {
    expect(resolveCodexProfileModelFromStore(store({}))).toBe("Qwen3.5-codex");
  });

  test("falls back to active codex profile modelId", () => {
    expect(
      resolveCodexProfileModelFromStore(
        store({
          effectiveCodexModel: null,
          profiles: [
            {
              id: "codex-1",
              company: "Bailian",
              name: "Qwen3.7",
              modelId: "Qwen3.7",
              settingsJson: "{}",
              engine: "codex",
              createdAtMs: 0,
              updatedAtMs: 0,
            },
          ],
        }),
      ),
    ).toBe("Qwen3.7");
  });
});

describe("resolveCodexExecModelId", () => {
  test("uses codex profile when context is claude", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "Qwen3.7",
        contextExecutionEngine: "claude",
        store: store({ effectiveCodexModel: "Qwen3.5-codex" }),
      }),
    ).toBe("Qwen3.5-codex");
  });

  test("does not use session model under claude context without codex profile", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "glm-5.1",
        contextExecutionEngine: "claude",
        store: store({ effectiveCodexModel: null, profiles: [] }),
      }),
    ).toBeUndefined();
  });

  test("falls back to session model only when context is codex", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "custom-codex-model",
        contextExecutionEngine: "codex",
        store: store({ effectiveCodexModel: null, profiles: [] }),
      }),
    ).toBe("custom-codex-model");
  });
});

describe("resolveCodexContextExecutionEngine", () => {
  const sessions = [
    { id: "main", repositoryPath: "/r", repositoryName: "demo" },
    { id: "worker", repositoryPath: "/r", repositoryName: "demo/员工:codex" },
  ];

  test("terminal dispatch uses main session engine", () => {
    expect(
      resolveCodexContextExecutionEngine({
        tabSessionId: "worker",
        terminalFreshTurn: true,
        activeSessionId: "main",
        sessions,
        resolveEngine: (session) => (session.id === "main" ? "claude" : "codex"),
      }),
    ).toBe("claude");
  });

  test("direct worker execute uses worker engine", () => {
    expect(
      resolveCodexContextExecutionEngine({
        tabSessionId: "worker",
        sessions,
        resolveEngine: (session) => (session.id === "main" ? "claude" : "codex"),
      }),
    ).toBe("codex");
  });
});
