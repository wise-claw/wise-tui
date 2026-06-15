import { describe, expect, test } from "bun:test";
import {
  COMPOSER_PROXY_LABELS,
  resolveComposerActiveProxyLabel,
} from "./composerActiveProxyLabel";

describe("resolveComposerActiveProxyLabel", () => {
  test("claude prefers opencode go over llm proxy", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "claude",
        { enabled: true, running: true, claudeSettingsAligned: true, codexSettingsAligned: true },
        { listening: true, running: true },
        null,
      ),
    ).toBe(COMPOSER_PROXY_LABELS.opencodeGo);
  });

  test("claude shows llm proxy when opencode is off", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "claude",
        { enabled: false, running: false, claudeSettingsAligned: false, codexSettingsAligned: false },
        { listening: true, running: true },
        null,
      ),
    ).toBe(COMPOSER_PROXY_LABELS.llmProxy);
  });

  test("claude shows fcc when settings route through fcc without spawn override", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "claude",
        { enabled: false, running: false, claudeSettingsAligned: false, codexSettingsAligned: false },
        { listening: false, running: false },
        { serverRunning: true, claudeSettingsAligned: true },
      ),
    ).toBe(COMPOSER_PROXY_LABELS.fcc);
  });

  test("codex shows opencode proxy when bridge is active", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "codex",
        { enabled: true, running: true, claudeSettingsAligned: true, codexSettingsAligned: false },
        null,
        null,
      ),
    ).toBe(COMPOSER_PROXY_LABELS.opencodeGo);
  });

  test("cursor engine has no proxy label", () => {
    expect(
      resolveComposerActiveProxyLabel(
        "cursor",
        { enabled: true, running: true, claudeSettingsAligned: true, codexSettingsAligned: true },
        { listening: true, running: true },
        { serverRunning: true, claudeSettingsAligned: true },
      ),
    ).toBeNull();
  });
});
