import {
  COMPOSER_SPEECH_PREFERENCES_SETTING_KEY,
  DEFAULT_COMPOSER_SPEECH_PREFERENCES,
  type ComposerSpeechPreferencesV1,
  type ComposerSpeechSendMode,
} from "../constants/composerSpeechPreferences";
import { normalizeComposerSpeechAutoSendEndingText } from "../utils/composerSpeechAutoSendEnding";
import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

let current: ComposerSpeechPreferencesV1 = { ...DEFAULT_COMPOSER_SPEECH_PREFERENCES };
let hydrated = false;
let hydrating = false;

const SEND_MODES = new Set<ComposerSpeechSendMode>(["manual", "silenceAutoSend", "endingWordAutoSend"]);

function coerceSendMode(raw: unknown): ComposerSpeechSendMode {
  if (raw === "holdAutoSend") return "silenceAutoSend";
  return SEND_MODES.has(raw as ComposerSpeechSendMode)
    ? (raw as ComposerSpeechSendMode)
    : DEFAULT_COMPOSER_SPEECH_PREFERENCES.sendMode;
}

export function normalizeComposerSpeechPreferences(
  raw: unknown,
): ComposerSpeechPreferencesV1 {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_COMPOSER_SPEECH_PREFERENCES };
  }
  const o = raw as Record<string, unknown>;
  const autoSendEndingText =
    typeof o.autoSendEndingText === "string"
      ? normalizeComposerSpeechAutoSendEndingText(o.autoSendEndingText)
      : "";
  return {
    sendMode: coerceSendMode(o.sendMode),
    autoSendEndingText:
      autoSendEndingText || DEFAULT_COMPOSER_SPEECH_PREFERENCES.autoSendEndingText,
    speechToRequirementEnabled: o.speechToRequirementEnabled === true,
  };
}

export function getComposerSpeechPreferencesSync(): ComposerSpeechPreferencesV1 {
  return { ...current };
}

export async function hydrateComposerSpeechPreferences(): Promise<ComposerSpeechPreferencesV1> {
  if (hydrated) return getComposerSpeechPreferencesSync();
  if (hydrating) return getComposerSpeechPreferencesSync();
  hydrating = true;
  const stored = await getAppSettingJson<unknown>(COMPOSER_SPEECH_PREFERENCES_SETTING_KEY);
  current = normalizeComposerSpeechPreferences(stored);
  hydrated = true;
  hydrating = false;
  return getComposerSpeechPreferencesSync();
}

export async function saveComposerSpeechPreferences(
  next: ComposerSpeechPreferencesV1,
): Promise<ComposerSpeechPreferencesV1> {
  current = normalizeComposerSpeechPreferences(next);
  await setAppSettingJson(COMPOSER_SPEECH_PREFERENCES_SETTING_KEY, current);
  return getComposerSpeechPreferencesSync();
}

export async function patchComposerSpeechPreferences(
  patch: Partial<ComposerSpeechPreferencesV1>,
): Promise<ComposerSpeechPreferencesV1> {
  return saveComposerSpeechPreferences({
    ...current,
    ...patch,
  });
}
