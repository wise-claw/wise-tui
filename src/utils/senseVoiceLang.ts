import type { SenseVoiceLanguagePreference } from "../constants/composerSpeechPreferences";

export const SENSE_VOICE_LANGUAGE_OPTIONS: {
  value: SenseVoiceLanguagePreference;
  label: string;
}[] = [
  { value: "auto", label: "自动" },
  { value: "zh", label: "中文" },
  { value: "yue", label: "粤语" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

export function normalizeSenseVoiceLanguagePreference(
  raw: unknown,
): SenseVoiceLanguagePreference {
  const allowed = new Set<SenseVoiceLanguagePreference>(["auto", "zh", "en", "yue", "ja", "ko"]);
  return allowed.has(raw as SenseVoiceLanguagePreference)
    ? (raw as SenseVoiceLanguagePreference)
    : "auto";
}

/** 传给 Tauri SenseVoice 识别的语言参数。 */
export function senseVoiceLangToInvokeArg(pref: SenseVoiceLanguagePreference): string {
  if (pref === "auto") return "auto";
  return pref;
}
