import {
  normalizeSessionDisplayLanguage,
  type SessionDisplayLanguage,
} from "../constants/sessionDisplayLanguage";

/** 代码 / 命令 / 标识符等不应被语言要求翻译的部分。 */
const NO_TRANSLATE_CLAUSE =
  "- 代码、命令、文件路径、标识符、日志与引用原文保持原样，不要翻译。";

const REPLY_LANGUAGE_INSTRUCTION: Record<Exclude<SessionDisplayLanguage, "auto">, string> = {
  "zh-CN": "始终使用简体中文回复。",
  en: "Always reply in English.",
  ja: "常に日本語で回答してください。",
};

/**
 * Claude `--append-system-prompt` 使用的语言块。
 * `auto`（跟随引擎默认）返回空串，不注入任何内容。
 */
export function buildSessionDisplayLanguageSystemPromptBlock(raw: unknown): string {
  const language = normalizeSessionDisplayLanguage(raw);
  if (language === "auto") return "";
  return [
    "## 会话回复语言",
    `- ${REPLY_LANGUAGE_INSTRUCTION[language]}`,
    NO_TRANSLATE_CLAUSE,
  ].join("\n");
}

/**
 * 不支持追加 system prompt 的引擎（Codex / Cursor / OpenCode / DeepSeek / Qoder）：
 * 把语言要求作为本轮前缀并入用户消息；`auto` 时原样返回。
 */
export function applySessionDisplayLanguageToPrompt(raw: unknown, prompt: string): string {
  const block = buildSessionDisplayLanguageSystemPromptBlock(raw);
  if (!block) return prompt;
  return `【会话回复语言要求】\n${block}\n\n${prompt}`;
}
