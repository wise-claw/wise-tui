import {
  COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MAX,
  COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MIN,
  COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_STEP,
  COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MAX,
  COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MIN,
  COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_STEP,
  DEFAULT_COMPOSER_SPEECH_PREFERENCES,
} from "../constants/composerSpeechPreferences";

export function normalizeSilenceAutoSendIdleMs(raw: unknown): number {
  const fallback = DEFAULT_COMPOSER_SPEECH_PREFERENCES.silenceAutoSendIdleMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const stepped =
    Math.round(raw / COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_STEP) *
    COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_STEP;
  return Math.min(
    COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MAX,
    Math.max(COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MIN, stepped),
  );
}

export function normalizeManualSegmentIdleMs(raw: unknown): number {
  const fallback = DEFAULT_COMPOSER_SPEECH_PREFERENCES.manualSegmentIdleMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const stepped =
    Math.round(raw / COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_STEP) *
    COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_STEP;
  return Math.min(
    COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MAX,
    Math.max(COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MIN, stepped),
  );
}

/** 用于菜单/提示文案，如 1500 → "1.5"、2000 → "2"。 */
export function formatSilenceAutoSendIdleSeconds(ms: number): string {
  const sec = ms / 1000;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

/** 同上，针对手动段尾空闲。 */
export function formatManualSegmentIdleSeconds(ms: number): string {
  return formatSilenceAutoSendIdleSeconds(ms);
}
