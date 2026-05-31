import { beforeEach, describe, expect, test } from "bun:test";
import type { DetectedAgent } from "../types/detectedAgent";
import {
  getAgentRegistrySnapshot,
  publishAgentRegistry,
  selectCodexAvailable,
  selectCursorAvailable,
} from "./agentRegistryStore";

const codexReady = {
  id: "codex",
  name: "Codex CLI",
  kind: "codex",
  available: true,
  backend: "codex",
  command: "codex",
  binaryPath: "/opt/homebrew/bin/codex",
  detectedAt: "2026-05-24T00:00:00.000Z",
} satisfies DetectedAgent<"codex">;

const codexMissing = {
  ...codexReady,
  available: false,
  binaryPath: undefined,
  failureReason: "binary not found on PATH",
} satisfies DetectedAgent<"codex">;

const cursorReady = {
  id: "cursor",
  name: "Cursor SDK",
  kind: "cursor",
  available: true,
  backend: "cursor",
  command: "cursor-sdk",
  detectedAt: "2026-05-24T00:00:00.000Z",
} satisfies DetectedAgent<"cursor">;

describe("agentRegistryStore", () => {
  beforeEach(() => {
    publishAgentRegistry([]);
  });

  test("selectCodexAvailable reflects codex availability after publish", () => {
    expect(selectCodexAvailable(getAgentRegistrySnapshot())).toBe(false);

    publishAgentRegistry([codexMissing]);
    expect(selectCodexAvailable(getAgentRegistrySnapshot())).toBe(false);

    publishAgentRegistry([codexReady]);
    expect(selectCodexAvailable(getAgentRegistrySnapshot())).toBe(true);
  });

  test("selectCursorAvailable reflects cursor availability after publish", () => {
    expect(selectCursorAvailable(getAgentRegistrySnapshot())).toBe(false);
    publishAgentRegistry([cursorReady]);
    expect(selectCursorAvailable(getAgentRegistrySnapshot())).toBe(true);
  });
});
