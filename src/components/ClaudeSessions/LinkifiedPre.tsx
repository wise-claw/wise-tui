import { useEffect, useMemo, useRef } from "react";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { HTTP_URL_BODY_RE, isValidHttpUrl, normalizeAutolinkUrl } from "../../utils/autolinkUrl";

function escapeHtmlPlain(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyEscapedPlain(escaped: string): string {
  HTTP_URL_BODY_RE.lastIndex = 0;
  return escaped.replace(HTTP_URL_BODY_RE, (raw) => {
    const href = normalizeAutolinkUrl(raw);
    if (!isValidHttpUrl(href)) return raw;
    const suffix = raw.slice(href.length);
    const link = `<a href="${escapeHtmlPlain(href)}" rel="noopener noreferrer" class="app-markdown-link">${escapeHtmlPlain(href)}</a>`;
    return suffix ? `${link}${escapeHtmlPlain(suffix)}` : link;
  });
}

function plainTextToLinkedHtml(text: string): string {
  return linkifyEscapedPlain(escapeHtmlPlain(text));
}

/** 纯文本中的 http(s) 链接可点击，在系统默认浏览器中打开 */
export function LinkifiedPre({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const html = useMemo(() => plainTextToLinkedHtml(text), [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachExternalLinkDelegation(el);
  }, []);
  return <pre ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
