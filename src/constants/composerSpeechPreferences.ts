/** SQLite `app_settings` 键：Composer 语音听写交互偏好。 */
export const COMPOSER_SPEECH_PREFERENCES_SETTING_KEY = "wise.composer.speech.v1" as const;

/** 手动：仅转写入框；停顿 1 秒无新语音片段则自动发送。 */
export type ComposerSpeechSendMode = "manual" | "silenceAutoSend";

/** @deprecated 旧偏好键，读取时映射为 `silenceAutoSend`。 */
export type ComposerSpeechSendModeLegacy = "holdAutoSend";

export interface ComposerSpeechPreferencesV1 {
  sendMode: ComposerSpeechSendMode;
}

export const DEFAULT_COMPOSER_SPEECH_PREFERENCES: ComposerSpeechPreferencesV1 = {
  sendMode: "manual",
};

/** 转写流式更新后，超过该时长无新片段则触发自动发送。 */
export const COMPOSER_SPEECH_IDLE_AUTO_SEND_MS = 1000;
