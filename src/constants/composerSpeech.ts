/** Tauri 事件：composer 本地/流式语音转写 partial 或 final 结果。 */
export const COMPOSER_SPEECH_TRANSCRIPT_EVENT = "composer-speech-transcript" as const;

/** 运行时实际使用的听写引擎。 */
export type ComposerSpeechEngine = "sensevoice" | "web";

export interface ComposerSpeechTranscriptPayload {
  sessionId: string;
  transcript: string;
  isFinal: boolean;
  /** 识别失败时的本地化说明（final 且无 transcript 时常见）。 */
  error?: string;
}
