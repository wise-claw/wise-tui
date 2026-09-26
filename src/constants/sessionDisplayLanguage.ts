/**
 * 会话回复语言：控制助手在会话中的输出语言。
 *
 * - `auto`：不额外指定，沿用各执行引擎 / 助手提示词的默认语言。
 * - `zh-CN` / `en` / `ja`：始终以指定语言回复（代码、命令、路径与引用原文除外）。
 */
export type SessionDisplayLanguage = "auto" | "zh-CN" | "en" | "ja";

export const SESSION_DISPLAY_LANGUAGES = ["auto", "zh-CN", "en", "ja"] as const;

export const DEFAULT_SESSION_DISPLAY_LANGUAGE: SessionDisplayLanguage = "auto";

export const SESSION_DISPLAY_LANGUAGE_LABELS: Record<SessionDisplayLanguage, string> = {
  auto: "默认（跟随引擎）",
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
};

export function normalizeSessionDisplayLanguage(raw: unknown): SessionDisplayLanguage {
  if (typeof raw !== "string") return DEFAULT_SESSION_DISPLAY_LANGUAGE;
  const trimmed = raw.trim();
  return (SESSION_DISPLAY_LANGUAGES as readonly string[]).includes(trimmed)
    ? (trimmed as SessionDisplayLanguage)
    : DEFAULT_SESSION_DISPLAY_LANGUAGE;
}
