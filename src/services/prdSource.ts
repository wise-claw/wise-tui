import type { PrdInputMeta, PrdSourceType } from "../types";

const URL_REGEX = /^https?:\/\/\S+$/i;
const MARKDOWN_HINT_REGEX = /(^|\n)\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|```|\|.+\|)/m;
const MAX_INPUT_LENGTH = 200_000;

function detectSourceType(input: string): PrdSourceType {
  const trimmed = input.trim();
  if (URL_REGEX.test(trimmed)) return "url";
  if (MARKDOWN_HINT_REGEX.test(input)) return "markdown";
  return "plain_text";
}

export function parsePrdInput(input: string): PrdInputMeta {
  const raw = input.trim();
  if (!raw) {
    throw new Error("请输入 PRD 内容或链接。");
  }
  if (raw.length > MAX_INPUT_LENGTH) {
    throw new Error("输入内容过长，请分段处理后重试。");
  }

  const sourceType = detectSourceType(raw);
  return {
    sourceType,
    rawText: sourceType === "url" ? "" : raw,
    rawUrl: sourceType === "url" ? raw : null,
  };
}

export function validatePrdUrl(url: string): void {
  if (!URL_REGEX.test(url.trim())) {
    throw new Error("链接格式无效，请提供 http/https URL。");
  }
}
