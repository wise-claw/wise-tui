import { describe, expect, test } from "bun:test";
import { isAgentKind, type DetectedAgent, type DetectedAgentKind } from "./detectedAgent";

const base = {
  id: "claude",
  name: "Claude Code",
  available: true,
  backend: "claude",
  binaryPath: "/usr/local/bin/claude",
  detectedAt: "2026-05-17T00:00:00.000Z",
} satisfies Omit<DetectedAgent<"claude">, "kind" | "command">;

const samples = {
  claude: { ...base, kind: "claude", command: "claude" },
  codex: {
    ...base,
    id: "codex",
    name: "Codex CLI",
    backend: "codex",
    kind: "codex",
    command: "codex",
  },
  gemini: {
    ...base,
    id: "gemini",
    name: "Gemini CLI",
    backend: "gemini",
    kind: "gemini",
    command: "gemini",
  },
  opencode: {
    ...base,
    id: "opencode",
    name: "OpenCode",
    backend: "opencode",
    kind: "opencode",
    command: "opencode",
  },
  custom: {
    ...base,
    id: "custom:local",
    name: "Local Agent",
    backend: "custom",
    kind: "custom",
    command: "/bin/echo",
    args: ["hello"],
    env: { WISE_TEST: "1" },
  },
} satisfies Record<DetectedAgentKind, DetectedAgent>;

describe("isAgentKind", () => {
  test("narrows every detected agent kind", () => {
    for (const kind of Object.keys(samples) as DetectedAgentKind[]) {
      const agent: DetectedAgent = samples[kind];

      expect(isAgentKind(agent, kind)).toBe(true);
      if (isAgentKind(agent, kind)) {
        expect(agent.kind).toBe(kind);
      }
    }
  });

  test("returns false for a different kind", () => {
    const agent: DetectedAgent = samples.claude;

    expect(isAgentKind(agent, "custom")).toBe(false);
  });
});
