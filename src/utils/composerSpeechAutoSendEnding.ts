/** 语音转写：检测并剥离用作「自动发送」触发的口播结束词（不进入发送正文）。 */

export function normalizeComposerSpeechAutoSendEndingText(raw: string): string {
  return raw.trim();
}

/**
 * 若当前 utterance 以结束词结尾，返回剥离后的 utterance 并标记应自动发送。
 * 结束词仅作触发标识，不写入输入框。
 */
export function splitUtteranceAtAutoSendEnding(
  utterance: string,
  endingText: string,
): { utterance: string; shouldAutoSend: boolean } {
  const ending = normalizeComposerSpeechAutoSendEndingText(endingText);
  if (!ending) {
    return { utterance, shouldAutoSend: false };
  }

  const normalized = utterance.replace(/\s+/g, " ").trim();
  if (!normalized.endsWith(ending)) {
    return { utterance, shouldAutoSend: false };
  }

  const stripped = normalized.slice(0, normalized.length - ending.length).trimEnd();
  return { utterance: stripped, shouldAutoSend: true };
}
