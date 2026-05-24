import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../../types/assistant";
import type { DetectedAgent } from "../../types/detectedAgent";
import {
  buildAgentEngineIndex,
  resolveAssistantEngineBinding,
  summarizeAssistantEngineBindings,
} from "./engineBinding";

const availableClaude: DetectedAgent<"claude"> = {
  id: "claude",
  name: "Claude Code",
  kind: "claude",
  available: true,
  backend: "claude",
  command: "claude",
  binaryPath: "/bin/claude",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const availableCodex: DetectedAgent<"codex"> = {
  id: "codex",
  name: "Codex CLI",
  kind: "codex",
  available: true,
  backend: "codex",
  command: "codex",
  binaryPath: "/bin/codex",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const unavailableCodex: DetectedAgent<"codex"> = {
  id: "codex",
  name: "Codex CLI",
  kind: "codex",
  available: false,
  backend: "codex",
  command: "codex",
  detectedAt: "2026-05-17T00:00:00.000Z",
  failureReason: "binary not found",
};

const assistants = [
  assistant("builtin.reviewer", "claude"),
  assistant("custom.writer", "codex"),
  assistant("extension.polish", "gemini"),
];

describe("assistant engine binding presentation", () => {
  test("resolves available, unavailable, and undetected bindings", () => {
    const index = buildAgentEngineIndex([availableClaude, unavailableCodex]);

    expect(resolveAssistantEngineBinding(assistants[0], index)).toMatchObject({
      label: "Claude Code 就绪",
      tone: "success",
      dotTone: "on",
      detail: "Claude Code",
    });
    expect(resolveAssistantEngineBinding(assistants[1], index)).toMatchObject({
      label: "运行入口不可用",
      tone: "danger",
      dotTone: "off",
      detail: "binary not found",
    });
    const codexIndex = buildAgentEngineIndex([availableCodex]);
    expect(resolveAssistantEngineBinding(assistants[1], codexIndex)).toMatchObject({
      label: "Codex CLI 就绪",
      tone: "success",
      dotTone: "on",
      detail: "Codex CLI",
    });
    expect(resolveAssistantEngineBinding(assistants[2], index)).toMatchObject({
      label: "预留入口未检测",
      tone: "warning",
      dotTone: "warn",
      detail: "运行入口未登记",
    });
  });

  test("summarizes runtime readiness for the template hub", () => {
    const index = buildAgentEngineIndex([availableClaude, unavailableCodex]);

    expect(summarizeAssistantEngineBindings(assistants, index)).toEqual({
      available: 1,
      unavailable: 1,
      undetected: 1,
    });
  });
});

function assistant(id: string, engineId: string): AssistantEntry {
  return {
    id,
    source: id.startsWith("custom.") ? "custom" : id.startsWith("extension.") ? "extension" : "builtin",
    name: id,
    description: "",
    avatarColor: null,
    engineId,
    model: null,
    systemPrompt: "",
    createdAt: "",
    updatedAt: "",
  };
}
