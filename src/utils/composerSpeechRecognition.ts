/** Web Speech API 构造器（Chromium / Safari 前缀不一）。 */
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() != null;
}

/** 在光标处插入听写文本；仅在中英文混排且两侧均为拉丁字母/数字时补前导空格。 */
export function buildSpeechInsertion(
  plain: string,
  cursor: number,
  transcript: string,
): { insertion: string; nextCursor: number } {
  const chunk = transcript.replace(/\s+/g, " ").trim();
  if (!chunk) {
    const c = Math.max(0, Math.min(cursor, plain.length));
    return { insertion: "", nextCursor: c };
  }
  const c = Math.max(0, Math.min(cursor, plain.length));
  const prefix = needsLeadingSpaceBeforeInsert(plain, c, chunk) ? " " : "";
  const insertion = `${prefix}${chunk}`;
  return { insertion, nextCursor: c + insertion.length };
}

export function needsLeadingSpaceBeforeInsert(plain: string, cursor: number, insertion: string): boolean {
  if (!insertion || cursor <= 0) return false;
  const prev = plain[cursor - 1]!;
  const first = insertion[0]!;
  return /\S/u.test(prev) && /\S/u.test(first) && /[A-Za-z0-9]/u.test(prev) && /[A-Za-z0-9]/u.test(first);
}

export function collectFinalSpeechTranscript(event: SpeechRecognitionResultEventLike): string {
  let out = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result?.isFinal) continue;
    const piece = result[0]?.transcript ?? "";
    if (piece) out += piece;
  }
  return out;
}

export function speechRecognitionErrorMessage(error: string | undefined): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "无法使用麦克风。若未看到授权弹窗，请完全退出 Wise 后重新打开，或在「系统设置 → 隐私与安全性 → 麦克风」中开启 Wise。";
    case "audio-capture":
      return "未检测到可用麦克风。";
    case "network":
      return "语音听写需要网络连接。";
    case "aborted":
      return "";
    case "no-speech":
      return "未识别到语音，请靠近麦克风后重试。";
    default:
      return error ? `语音听写失败：${error}` : "语音听写失败，请稍后重试。";
  }
}
