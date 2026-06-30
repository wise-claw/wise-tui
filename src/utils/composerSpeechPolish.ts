/** 语音听写：将 ASR 口语转写「智能整理」为可发送的清晰表达（纯函数 + prompt）。
 *
 * 设计：整理 = 纠正错字、去口头语、补标点、规整表达，但**保留全部语义与细节，不做压缩总结**。
 * LLM 走 {@link buildComposerSpeechPolishPrompt}；无 LLM 时退化为 {@link applyLocalSpeechPolishFallback}
 * 的纯本地清理，两条路径都保证落到输入框的文本已被整理过（绝不直接写入原始转写）。
 */

/** 单字口头语（语气词），任何位置出现都可安全去除。 */
const SPEECH_FILLER_SINGLE = "嗯|呃|额|诶|唉|哦|喔|噢";

/** 仅在小句开头出现时才视作口头语去除的多字迟疑语（句中可能是实义词，保守处理）。 */
const SPEECH_FILLER_LEADING = [
  "那个",
  "这个",
  "就是说",
  "就是",
  "然后呢",
  "然后就是",
  "怎么说呢",
  "这样的话",
  "对对对",
  "对对",
];

const CLAUSE_BOUNDARY = "，。！？、,.!?;:：；…\\s";

/** 句首/小句首的迟疑语：`(^|<标点>)(那个|就是…)(、，)?`。 */
const SPEECH_FILLER_LEADING_PATTERN = new RegExp(
  `(^|[${CLAUSE_BOUNDARY}])(?:${SPEECH_FILLER_LEADING.join("|")})(?=[${CLAUSE_BOUNDARY}]|$)[，、,]?`,
  "gu",
);

/** 任意位置的单字语气词：`(^|<标点/空白>)(嗯|呃…)(?=<标点/空白>|$)`。 */
const SPEECH_FILLER_SINGLE_PATTERN = new RegExp(
  `(^|[${CLAUSE_BOUNDARY}])(?:${SPEECH_FILLER_SINGLE})(?=[${CLAUSE_BOUNDARY}]|$)`,
  "gu",
);

/** 连续重复语气词（如「嗯嗯嗯」「啊啊」）压缩。 */
const SPEECH_FILLER_RUN_PATTERN = /([嗯啊呃额诶哦喔噢])\1{1,}/gu;

export function buildComposerSpeechPolishPrompt(rawTranscript: string): string {
  const raw = rawTranscript.trim();
  return [
    "你是语音转写整理助手。将下列口语转写整理为一条清晰、可直接发送的中文消息。",
    "要求：",
    "1. 纠正明显的 ASR 错字、同音字与断句错误；",
    "2. 去掉无意义的口头语与迟疑词（嗯、啊、那个、就是、然后等）；",
    "3. 补全必要的标点，规整句子结构；",
    "4. 必须完整保留原文表达的全部信息与细节，不要压缩、不要总结、不要扩写、不要添加原文没有的内容；",
    "5. 不要使用 Markdown，不要加任何前后说明或引号包裹。",
    "若原文已足够清晰，只做最少改动。只输出整理后的正文。",
    "",
    "原文：",
    raw,
  ].join("\n");
}

/** 多余空白与标点的规整：折叠空白、压缩重复标点、去掉中文标点前的多余空格。 */
function tidySpeechPunctuationAndSpace(input: string): string {
  let text = input.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // 折叠重复的中文/英文标点（保留省略号「……」与英文「...」语义）
  text = text.replace(/([，。！？、；：])\1+/gu, "$1");
  // 去掉中文标点前的空格、闭引号/括号前空格
  text = text.replace(/\s+([，。！？、；：）」』】])/gu, "$1");
  // 去掉开引号/括号后的空格
  text = text.replace(/([（「『【])\s+/gu, "$1");
  // 小句开头遗留的孤立标点（口头语被去掉后常见）
  text = text.replace(/(^|[。！？\n])[，、；：]+/gu, "$1");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 无 LLM 时的本地智能整理：去语气词 / 句首迟疑语、压缩重复、规整标点与空白。
 * 保守：句中的多字词不动，只清理句首迟疑语，避免破坏语义。
 */
export function applyLocalSpeechPolishFallback(rawTranscript: string): string {
  let text = rawTranscript.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // 反复清理直到稳定（去掉一个句首迟疑语后可能暴露下一个）。
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text.replace(SPEECH_FILLER_RUN_PATTERN, "$1");
    text = text.replace(SPEECH_FILLER_SINGLE_PATTERN, "$1");
    text = text.replace(SPEECH_FILLER_LEADING_PATTERN, "$1");
    text = tidySpeechPunctuationAndSpace(text);
    if (text === before) break;
  }

  return tidySpeechPunctuationAndSpace(text);
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
  // 整理（非总结）不应显著变长；超长视为模型跑飞，退回本地整理结果。
  const maxLen = Math.max(fb.length * 4, fb.length + 800);
  if (text.length > maxLen) return fb;
  return text;
}
