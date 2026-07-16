import { beforeEach, describe, expect, test } from "bun:test";
import type { DetectedAgent, LatestVersionInfo } from "../types/detectedAgent";
import {
  getAgentRegistrySnapshot,
  publishAgentRegistry,
  publishLatestVersions,
  selectCodexAvailable,
  selectCursorAvailable,
  selectLatestForKind,
  selectUpgradableCount,
  subscribeAgentRegistry,
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
  name: "Cursor CLI",
  kind: "cursor",
  available: true,
  backend: "cursor",
  command: "agent",
  detectedAt: "2026-05-24T00:00:00.000Z",
} satisfies DetectedAgent<"cursor">;

describe("agentRegistryStore", () => {
  beforeEach(() => {
    publishAgentRegistry([]);
    // 清空 latestByKind:发布一组空数组在当前实现中不写,需手动 reset。
    // 这里通过 publishAgentRegistry 重置整个 snapshot 来兼容(latestByKind 会被替换为初始空 Map)。
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

describe("agentRegistryStore latest versions", () => {
  beforeEach(() => {
    publishAgentRegistry([]);
  });

  test("publishLatestVersions writes info readable via selectLatestForKind", () => {
    const info: LatestVersionInfo = {
      kind: "claude",
      installed: "1.0.0",
      latest: "1.2.0",
      upgradable: true,
      manual: false,
      checkedAt: 1_700_000_000,
    };
    publishLatestVersions([info]);
    const got = selectLatestForKind(getAgentRegistrySnapshot(), "claude");
    expect(got).toEqual(info);
  });

  test("publishLatestVersions notifies subscribers", () => {
    let notifications = 0;
    const unsubscribe = subscribeAgentRegistry(() => {
      notifications += 1;
    });
    try {
      publishLatestVersions([
        {
          kind: "codex",
          installed: "0.1.0",
          latest: "0.2.0",
          upgradable: true,
          manual: false,
          checkedAt: 1,
        },
      ]);
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  test("selectUpgradableCount counts only upgradable entries", () => {
    publishLatestVersions([
      {
        kind: "claude",
        installed: "1.0.0",
        latest: "1.2.0",
        upgradable: true,
        manual: false,
        checkedAt: 1,
      },
      {
        kind: "codex",
        installed: "0.2.0",
        latest: "0.2.0",
        upgradable: false,
        manual: false,
        checkedAt: 1,
      },
      {
        kind: "cursor",
        installed: undefined,
        latest: undefined,
        upgradable: false,
        manual: true,
        checkedAt: 1,
      },
    ]);
    expect(selectUpgradableCount(getAgentRegistrySnapshot())).toBe(1);
  });

  test("publishLatestVersions with empty list is a no-op (does not clear existing entries)", () => {
    publishLatestVersions([
      {
        kind: "gemini",
        installed: "0.1.0",
        latest: "0.2.0",
        upgradable: true,
        manual: false,
        checkedAt: 1,
      },
    ]);
    publishLatestVersions([]);
    // 空数组不应清空已存在的 latestByKind。
    expect(
      selectLatestForKind(getAgentRegistrySnapshot(), "gemini")?.upgradable,
    ).toBe(true);
  });
});
