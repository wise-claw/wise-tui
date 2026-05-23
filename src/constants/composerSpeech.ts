/** Tauri 事件：composer 本地/流式语音转写 partial 或 final 结果。 */
export const COMPOSER_SPEECH_TRANSCRIPT_EVENT = "composer-speech-transcript" as const;

export interface ComposerSpeechTranscriptPayload {
  sessionId: string;
  transcript: string;
  isFinal: boolean;
}
