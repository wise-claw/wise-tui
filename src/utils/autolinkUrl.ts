/**
 * 从聊天/纯文本中识别 http(s) URL 时截断尾部误纳入的中文与标点（GFM autolink 常见误报）。
 * 命中率公式侧：仅处理展示链接，不改变原始消息文本。
 */

/** URL 主体：ASCII + percent-encoding；不含未编码 CJK。 */
export const HTTP_URL_BODY_RE =
  /https?:\/\/(?:[a-zA-Z0-9\-._~:/?#@!$&'()*+,;=%]|%[0-9A-Fa-f]{2})+/gi;

const TRAILING_URL_JUNK_RE =
  /(?:[),.;!?]+|[\u3000-\u303f\uff00-\uffef]|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])+$/u;

function tryDecodeUriComponent(url: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(url)) return url;
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function stripTrailingUrlJunk(url: string): string {
  let out = url;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(TRAILING_URL_JUNK_RE, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 去掉误并入链接尾部的中文、全角标点及句末 ASCII 标点。 */
export function normalizeAutolinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const decoded = stripTrailingUrlJunk(tryDecodeUriComponent(trimmed));
  try {
    const u = new URL(decoded);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return decoded;
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtmlPlain(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 对已 HTML 转义的纯文本片段做 http(s) 自动链接（供 pre / 代码围栏复用）。 */
export function linkifyEscapedPlain(escaped: string): string {
  HTTP_URL_BODY_RE.lastIndex = 0;
  return escaped.replace(HTTP_URL_BODY_RE, (raw) => {
    const href = normalizeAutolinkUrl(raw);
    if (!isValidHttpUrl(href)) return raw;
    const suffix = raw.slice(href.length);
    const link = `<a href="${escapeHtmlPlain(href)}" rel="noopener noreferrer" class="app-markdown-link">${escapeHtmlPlain(href)}</a>`;
    return suffix ? `${link}${escapeHtmlPlain(suffix)}` : link;
  });
}

/** 纯文本 → 转义 + 可点击 http(s) 链接的 HTML。 */
export function plainTextToLinkedHtml(text: string): string {
  return linkifyEscapedPlain(escapeHtmlPlain(text));
}
