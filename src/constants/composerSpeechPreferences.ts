/** SQLite `app_settings` 键：Composer 语音听写交互偏好。 */
export const COMPOSER_SPEECH_PREFERENCES_SETTING_KEY = "wise.composer.speech.v1" as const;

/** 手动：仅转写入框，需点击停止后再手动发送。 */
export type ComposerSpeechSendMode = "manual" | "silenceAutoSend" | "endingWordAutoSend";

/**
 * 手动模式"段尾空闲"空闲时长（毫秒）：
 * - 停顿时长到达后，若仍在 listening 则视作当前段说完，自动 finalize 入框但不发送，
 *   保持 listening 以便继续下一段。
 * - 故意与 `silenceAutoSendIdleMs` 解耦：
 *   - silenceAutoSend：沉默 = 整段结束并发出（不同语义）
 *   - manual：沉默 = 一段结束但不发（避免相互误伤）
 * - 默认 1s。可在语音听写弹窗配置。
 */

/** @deprecated 旧偏好键，读取时映射为 `silenceAutoSend`。 */
export type ComposerSpeechSendModeLegacy = "holdAutoSend";

/** 用户可选的听写引擎策略。 */
export type ComposerSpeechEnginePreference = "auto" | "sensevoice" | "web";

export interface ComposerSpeechPreferencesV1 {
  sendMode: ComposerSpeechSendMode;
  /** 口播该结束词时自动发送；不写入发给 Claude 的正文。 */
  autoSendEndingText: string;
  /** 停顿自动发送：转写流式更新后，超过该时长（毫秒）无新片段则触发发送。 */
  silenceAutoSendIdleMs: number;
  /** 手动模式段尾空闲阈值：停顿该时长（毫秒）自动 finalize 入框但不发送，保持 listening 继续下一段。 */
  manualSegmentIdleMs: number;
  /** 整理方式：true=AI 智能整理（带本地兜底），false=仅本地整理。无论开关如何，落到输入框的文本都已整理（绝不写入原始转写）。默认开启。 */
  speechPolishEnabled: boolean;
  /** 听写引擎策略：auto=SenseVoice 优先；sensevoice/web=显式指定（不可用时降级）。 */
  speechEngineMode: ComposerSpeechEnginePreference;
  /** SenseVoice 识别语言（仅 Sherpa 引擎生效）。 */
  senseVoiceLang: SenseVoiceLanguagePreference;
  /** 听写过程中识别口播命令（发送 / 清除 / 取消任务等）。 */
  voiceCommandsEnabled: boolean;
  /** 口播「清除」类命令：清空会话输入框内容（不写入正文）。 */
  voiceCommandClearText: string;
  /** 口播「取消」类命令：结束当前会话执行（等同底栏「结束」）。 */
  voiceCommandCancelText: string;
}

/** SenseVoice 支持的语言偏好。 */
export type SenseVoiceLanguagePreference = "auto" | "zh" | "en" | "yue" | "ja" | "ko";

export const DEFAULT_COMPOSER_SPEECH_PREFERENCES: ComposerSpeechPreferencesV1 = {
  sendMode: "manual",
  autoSendEndingText: "发送",
  silenceAutoSendIdleMs: 1000,
  manualSegmentIdleMs: 1000,
  speechPolishEnabled: true,
  speechEngineMode: "auto",
  senseVoiceLang: "auto",
  voiceCommandsEnabled: true,
  voiceCommandClearText: "清除",
  voiceCommandCancelText: "取消",
};

/** 停顿自动发送默认可调范围（毫秒）。 */
export const COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MIN = 400;
export const COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_MAX = 10_000;
export const COMPOSER_SPEECH_SILENCE_AUTO_SEND_IDLE_MS_STEP = 100;

/** 手动模式段尾空闲默认可调范围（毫秒）。 */
export const COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MIN = 400;
export const COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_MAX = 10_000;
export const COMPOSER_SPEECH_MANUAL_SEGMENT_IDLE_MS_STEP = 100;

/** @deprecated 使用 `DEFAULT_COMPOSER_SPEECH_PREFERENCES.silenceAutoSendIdleMs`。 */
export const COMPOSER_SPEECH_IDLE_AUTO_SEND_MS =
  DEFAULT_COMPOSER_SPEECH_PREFERENCES.silenceAutoSendIdleMs;
