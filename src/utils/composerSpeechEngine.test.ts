import { describe, expect, test } from "bun:test";
import {
  normalizeComposerSpeechEnginePreference,
  resolveComposerSpeechEngine,
} from "./composerSpeechEngine";

describe("composerSpeechEngine", () => {
  test("auto prefers sensevoice when models ready", () => {
    expect(
      resolveComposerSpeechEngine({
        preference: "auto",
        sherpaReady: true,
        webSupported: true,
      }),
    ).toBe("sensevoice");
  });

  test("auto falls back to web when sensevoice unavailable", () => {
    expect(
      resolveComposerSpeechEngine({
        preference: "auto",
        sherpaReady: false,
        webSupported: true,
      }),
    ).toBe("web");
  });

  test("sensevoice preference uses sherpa when ready", () => {
    expect(
      resolveComposerSpeechEngine({
        preference: "sensevoice",
        sherpaReady: true,
        webSupported: true,
      }),
    ).toBe("sensevoice");
  });

  test("sensevoice preference falls back to web when models missing", () => {
    expect(
      resolveComposerSpeechEngine({
        preference: "sensevoice",
        sherpaReady: false,
        webSupported: true,
      }),
    ).toBe("web");
  });

  test("web preference only uses web speech", () => {
    expect(
      resolveComposerSpeechEngine({
        preference: "web",
        sherpaReady: true,
        webSupported: true,
      }),
    ).toBe("web");
  });

  test("normalizeComposerSpeechEnginePreference migrates apple and falls back to auto", () => {
    expect(normalizeComposerSpeechEnginePreference("apple")).toBe("sensevoice");
    expect(normalizeComposerSpeechEnginePreference("invalid")).toBe("auto");
    expect(normalizeComposerSpeechEnginePreference("sensevoice")).toBe("sensevoice");
  });
});
