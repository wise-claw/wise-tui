import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type { ComposerSpeechEnginePreference } from "../constants/composerSpeechPreferences";

export type { ComposerSpeechEnginePreference };

export interface ResolveComposerSpeechEngineInput {
  preference: ComposerSpeechEnginePreference;
  sherpaReady: boolean;
  webSupported: boolean;
}

const ENGINE_PREFERENCES = new Set<ComposerSpeechEnginePreference>([
  "auto",
  "sensevoice",
  "web",
]);

/** 兼容旧偏好：apple → sensevoice。 */
export function normalizeComposerSpeechEnginePreference(
  raw: unknown,
): ComposerSpeechEnginePreference {
  if (raw === "apple") return "sensevoice";
  return ENGINE_PREFERENCES.has(raw as ComposerSpeechEnginePreference)
    ? (raw as ComposerSpeechEnginePreference)
    : "auto";
}

/** 根据偏好与运行时能力解析实际使用的听写引擎。 */
export function resolveComposerSpeechEngine(
  input: ResolveComposerSpeechEngineInput,
): ComposerSpeechEngine | null {
  const { preference, sherpaReady, webSupported } = input;

  if (preference === "web") {
    return webSupported ? "web" : null;
  }

  if (preference === "sensevoice") {
    if (sherpaReady) return "sensevoice";
    return webSupported ? "web" : null;
  }

  // auto：SenseVoice 已就绪时优先，否则 Web Speech
  if (sherpaReady) return "sensevoice";
  return webSupported ? "web" : null;
}

export function composerSpeechEnginePreferenceLabel(
  preference: ComposerSpeechEnginePreference,
): string {
  switch (preference) {
    case "auto":
      return "自动";
    case "sensevoice":
      return "SenseVoice";
    case "web":
      return "Web";
    default:
      return "自动";
  }
}
