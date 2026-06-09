import { describe, expect, test } from "bun:test";
import {
  anthropicProxyConflictMessage,
  anthropicProxyConflictMessages,
  resolveAnthropicProxyConflict,
} from "./anthropicProxyConflict";

describe("anthropicProxyConflict", () => {
  test("opencode go wins when both active", () => {
    const view = resolveAnthropicProxyConflict(
      { enabled: true, running: true, claudeSettingsAligned: true },
      { listening: true, running: true },
    );
    expect(view.opencodeLlmBothActive).toBe(true);
    expect(view.claudeSpawnOwner).toBe("opencode-go");
    expect(anthropicProxyConflictMessage(view)).toContain("OpenCode 代理");
  });

  test("llm proxy alone is active owner", () => {
    const view = resolveAnthropicProxyConflict(
      { enabled: false, running: false, claudeSettingsAligned: false },
      { listening: true, running: true },
    );
    expect(view.claudeSpawnOwner).toBe("llm-proxy");
    expect(anthropicProxyConflictMessage(view)).toBeNull();
  });

  test("warns when opencode and fcc both run", () => {
    const view = resolveAnthropicProxyConflict(
      { enabled: true, running: true, claudeSettingsAligned: true },
      { listening: false, running: false },
      { serverRunning: true, claudeSettingsAligned: true },
    );
    expect(view.opencodeFccConflict).toBe(true);
    expect(anthropicProxyConflictMessages(view).some((m) => m.includes("FCC"))).toBe(true);
  });

  test("warns when settings still point to fcc", () => {
    const view = resolveAnthropicProxyConflict(
      { enabled: true, running: true, claudeSettingsAligned: false },
      { listening: false, running: false },
      { serverRunning: false, claudeSettingsAligned: true },
    );
    expect(view.opencodeFccConflict).toBe(true);
    expect(anthropicProxyConflictMessage(view)).toContain("settings.json");
  });
});
