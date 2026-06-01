import { isSafeExternalHref } from "../services/openExternal";

export const MODEL_PROFILE_OFFICIAL_WEBSITE_MAX_LENGTH = 512;

/** 输入时剔除控制字符，保留常见 URL 字符。 */
export function normalizeModelProfileOfficialWebsiteInput(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

/** 规范化官网地址：补全协议并校验 http(s)。 */
export function normalizeModelProfileOfficialWebsite(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  if (!isSafeExternalHref(withProtocol)) return null;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function validateModelProfileOfficialWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MODEL_PROFILE_OFFICIAL_WEBSITE_MAX_LENGTH) {
    return `官网地址不能超过 ${MODEL_PROFILE_OFFICIAL_WEBSITE_MAX_LENGTH} 个字符`;
  }
  if (!normalizeModelProfileOfficialWebsite(trimmed)) {
    return "官网地址需为有效的 http:// 或 https:// 链接";
  }
  return null;
}
