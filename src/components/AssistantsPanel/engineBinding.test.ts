import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../../types/assistant";
import type { DetectedAgent } from "../../types/detectedAgent";
import {
  buildAgentEngineIndex,
  buildAssistantEngineOptions,
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

const availableGemini: DetectedAgent<"gemini"> = {
  id: "gemini",
  name: "Gemini CLI",
  kind: "gemini",
  available: true,
  backend: "gemini",
  command: "gemini",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const detectedCustom: DetectedAgent<"custom"> = {
  id: "custom:remote",
  name: "Remote wrapper",
  kind: "custom",
  available: true,
  backend: "custom",
  command: "ssh",
  args: ["example-host"],
  env: {},
  detectedAt: "2026-05-17T00:00:00.000Z",
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
    expect(resolveAssistantEngineBinding(assistant("custom.rpc", "codex-rpc"), codexIndex)).toMatchObject({
      label: "Codex CLI 就绪",
      tone: "success",
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

  test("distinguishes connected engines from detected custom commands", () => {
    const index = buildAgentEngineIndex([availableGemini, detectedCustom]);
    expect(resolveAssistantEngineBinding(assistant("builtin.gemini", "gemini"), index)).toMatchObject({
      label: "Gemini CLI 就绪",
      tone: "success",
    });
    expect(resolveAssistantEngineBinding(assistant("custom.remote", "custom:remote"), index)).toMatchObject({
      label: "预留命令已探测",
      tone: "warning",
      detail: "命令存在，但尚未接入会话派发",
    });
    expect(resolveAssistantEngineBinding(assistant("custom.legacy", "custom"), index)).toMatchObject({
      label: "预留入口未检测",
      tone: "warning",
    });
    expect(summarizeAssistantEngineBindings([
      assistant("builtin.gemini", "gemini"),
      assistant("custom.remote", "custom:remote"),
    ], index)).toEqual({ available: 1, unavailable: 0, undetected: 1 });
  });

  test("uses distinct custom IDs and exposes Codex RPC for template binding", () => {
    const anotherCustom = { ...detectedCustom, id: "custom:backup", name: "Backup wrapper" };
    const options = buildAssistantEngineOptions([availableCodex, detectedCustom, anotherCustom]);
    expect(options.find((option) => option.value === "codex-rpc")?.label).toContain("Codex RPC · 命令已探测");
    expect(options.find((option) => option.value === "codex")?.label).toContain("旧模板兼容");
    expect(options.filter((option) => option.value.startsWith("custom:")).map((option) => option.value)).toEqual([
      "custom:remote",
      "custom:backup",
    ]);
    expect(options.find((option) => option.value === "custom:remote")?.label).toContain("暂不可派发");
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
