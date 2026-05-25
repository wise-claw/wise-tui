/** 语音听写：将 ASR 口语转写整理为可发送的清晰表达（纯函数 + prompt）。 */

const SPEECH_FILLER_PATTERN =
  /(^|[，。！？；：、\s])(嗯|啊|呃|额|诶)(?=[，。！？；：、\s]|$)/gu;

export function buildComposerSpeechPolishPrompt(rawTranscript: string): string {
  const raw = rawTranscript.trim();
  return [
    "你是语音转写整理助手。将下列口语转写整理为一条清晰、可直接发送的中文消息。",
    "要求：纠正明显的 ASR 错字与同音字；去掉无意义的口头语（嗯、啊、那个等）；补全必要标点；不要扩写、不要加解释、不要 Markdown。",
    "若原文已足够清晰，只做最少改动。",
    "只输出整理后的正文，不要前后说明。",
    "",
    "原文：",
    raw,
  ].join("\n");
}

/** 无 Claude 时的轻量整理：去口头语与多余空白。 */
export function applyLocalSpeechPolishFallback(rawTranscript: string): string {
  let text = rawTranscript.replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(SPEECH_FILLER_PATTERN, "$1");
  return text.replace(/\s+/g, " ").trim();
}

export function sanitizePolishedSpeechOutput(output: string, fallback: string): string {
  const fb = fallback.trim();
  let text = output.trim();
  if (!text) return fb;

  const fenced = /^```[\w-]*\n?([\s\S]*?)\n?```$/u.exec(text);
  if (fenced) {
    text = fenced[1]!.trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("「") && text.endsWith("」")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  if (!text) return fb;
  const maxLen = Math.max(fb.length * 4, fb.length + 800);
  if (text.length > maxLen) return fb;
  return text;
}
