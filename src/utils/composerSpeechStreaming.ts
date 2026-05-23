/** 流式听写：在输入框锚点处合并 partial / final 转写文本。 */

import { buildSpeechInsertion } from "./composerSpeechRecognition";

export interface ComposerSpeechStreamAnchor {
  prefix: string;
  suffix: string;
}

export function createComposerSpeechStreamAnchor(plain: string, cursor: number): ComposerSpeechStreamAnchor {
  const c = Math.max(0, Math.min(cursor, plain.length));
  return {
    prefix: plain.slice(0, c),
    suffix: plain.slice(c),
  };
}

/** 将当前 utterance 的 partial 或 final 文本合并进 plain。final 时提交到 prefix。 */
export function applyComposerSpeechStreamTranscript(
  anchor: ComposerSpeechStreamAnchor,
  utterance: string,
  isFinal: boolean,
): { anchor: ComposerSpeechStreamAnchor; plain: string; cursor: number } {
  const chunk = utterance.replace(/\s+/g, " ").trim();
  if (!chunk) {
    return {
      anchor,
      plain: anchor.prefix + anchor.suffix,
      cursor: anchor.prefix.length,
    };
  }

  const { insertion } = buildSpeechInsertion(anchor.prefix, anchor.prefix.length, chunk);
  const displayPlain = anchor.prefix + insertion + anchor.suffix;
  const displayCursor = anchor.prefix.length + insertion.length;

  if (!isFinal) {
    return { anchor, plain: displayPlain, cursor: displayCursor };
  }

  const committedPrefix = anchor.prefix + insertion;
  return {
    anchor: { prefix: committedPrefix, suffix: anchor.suffix },
    plain: committedPrefix + anchor.suffix,
    cursor: committedPrefix.length,
  };
}
