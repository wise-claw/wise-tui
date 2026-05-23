/** SQLite `app_settings` 键：Composer 语音听写交互偏好。 */
export const COMPOSER_SPEECH_PREFERENCES_SETTING_KEY = "wise.composer.speech.v1" as const;

/** 手动：仅转写入框；停顿 1 秒无新语音片段则自动发送。 */
export type ComposerSpeechSendMode = "manual" | "silenceAutoSend" | "endingWordAutoSend";

/** @deprecated 旧偏好键，读取时映射为 `silenceAutoSend`。 */
export type ComposerSpeechSendModeLegacy = "holdAutoSend";

export interface ComposerSpeechPreferencesV1 {
  sendMode: ComposerSpeechSendMode;
  /** 口播该结束词时自动发送；不写入发给 Claude 的正文。 */
  autoSendEndingText: string;
  /** 开启后会话谈话内容自动追加到当前项目/仓库的需求草稿（与需求拆分助手保存一致）。 */
  speechToRequirementEnabled: boolean;
}

export const DEFAULT_COMPOSER_SPEECH_PREFERENCES: ComposerSpeechPreferencesV1 = {
  sendMode: "manual",
  autoSendEndingText: "发送",
  speechToRequirementEnabled: false,
};

/** 转写流式更新后，超过该时长无新片段则触发自动发送。 */
export const COMPOSER_SPEECH_IDLE_AUTO_SEND_MS = 1000;
