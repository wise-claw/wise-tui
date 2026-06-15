import { describe, expect, test } from "bun:test";
import {
  COMPOSER_PROXY_LABELS,
  resolveComposerActiveProxyLabel,
  resolveComposerActiveProxyRoute,
} from "./composerActiveProxyRoute";

describe("resolveComposerActiveProxyRoute", () => {
  test("claude prefers opencode go over llm proxy", () => {
    const route = resolveComposerActiveProxyRoute(
      "claude",
      {
        enabled: true,
        running: true,
        claudeSettingsAligned: true,
        codexSettingsAligned: true,
        proxyBaseUrl: "http://127.0.0.1:9876",
        port: 9876,
        defaultModel: "qwen3.7-plus",
      },
      { listening: true, running: true, localProxyUrl: "http://127.0.0.1:8765", port: 8765, upstream: "https://api.anthropic.com" },
      null,
    );
    expect(route?.label).toBe(COMPOSER_PROXY_LABELS.opencodeGo);
    expect(route?.kind).toBe("opencode-go");
    expect(route?.detail).toContain("9876");
    expect(route?.detail).toContain("qwen3.7-plus");
  });

  test("claude opencode warns when settings not aligned", () => {
    const route = resolveComposerActiveProxyRoute(
      "claude",
      {
        enabled: true,
        running: true,
        claudeSettingsAligned: false,
        codexSettingsAligned: false,
        proxyBaseUrl: "http://127.0.0.1:9876",
        port: 9876,
        defaultModel: "kimi-k2.6",
      },
      null,
      null,
    );
    expect(route?.needsAttention).toBe(true);
    expect(route?.attentionMessage).toContain("Claude settings");
  });

  test("codex ignores llm proxy and only uses opencode bridge", () => {
    expect(
      resolveComposerActiveProxyRoute(
        "codex",
        { enabled: false, running: false, claudeSettingsAligned: false, codexSettingsAligned: false, proxyBaseUrl: null, port: 9876, defaultModel: "kimi-k2.6" },
        { listening: true, running: true, localProxyUrl: "http://127.0.0.1:8765", port: 8765, upstream: "https://api.anthropic.com" },
        null,
      ),
    ).toBeNull();
    expect(
      resolveComposerActiveProxyRoute(
        "codex",
        { enabled: true, running: true, claudeSettingsAligned: true, codexSettingsAligned: true, proxyBaseUrl: "http://127.0.0.1:9876", port: 9876, defaultModel: "qwen3.7-plus" },
        { listening: true, running: true, localProxyUrl: null, port: 8765, upstream: "" },
        null,
      )?.kind,
    ).toBe("opencode-go");
  });

  test("claude shows llm proxy when opencode is off", () => {
    expect(
      resolveComposerActiveProxyRoute(
        "claude",
        { enabled: false, running: false, claudeSettingsAligned: false, codexSettingsAligned: false, proxyBaseUrl: null, port: 9876, defaultModel: "" },
        { listening: true, running: true, localProxyUrl: "http://127.0.0.1:8765", port: 8765, upstream: "https://api.anthropic.com" },
        null,
      )?.label,
    ).toBe(COMPOSER_PROXY_LABELS.llmProxy);
  });

  test("claude shows fcc when settings route through fcc without spawn override", () => {
    expect(
      resolveComposerActiveProxyRoute(
        "claude",
        { enabled: false, running: false, claudeSettingsAligned: false, codexSettingsAligned: false, proxyBaseUrl: null, port: 9876, defaultModel: "" },
        { listening: false, running: false, localProxyUrl: null, port: null, upstream: "" },
        { serverRunning: true, claudeSettingsAligned: true, proxyBaseUrl: "http://127.0.0.1:8080", model: "claude-sonnet" },
      )?.label,
    ).toBe(COMPOSER_PROXY_LABELS.fcc);
  });

  test("cursor engine has no proxy route", () => {
    expect(
      resolveComposerActiveProxyRoute(
        "cursor",
        { enabled: true, running: true, claudeSettingsAligned: true, codexSettingsAligned: true, proxyBaseUrl: "http://127.0.0.1:9876", port: 9876, defaultModel: "kimi-k2.6" },
        { listening: true, running: true, localProxyUrl: null, port: 8765, upstream: "" },
        { serverRunning: true, claudeSettingsAligned: true, proxyBaseUrl: "http://127.0.0.1:8080", model: null },
      ),
    ).toBeNull();
  });

  test("legacy label helper stays compatible", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "claude",
        {
          enabled: true,
          running: true,
          claudeSettingsAligned: true,
          codexSettingsAligned: true,
          proxyBaseUrl: "http://127.0.0.1:9876",
          port: 9876,
          defaultModel: "qwen3.7-plus",
        },
        { listening: true, running: true, localProxyUrl: "http://127.0.0.1:8765", port: 8765, upstream: "" },
        null,
      ),
    ).toBe(COMPOSER_PROXY_LABELS.opencodeGo);
  });
});
