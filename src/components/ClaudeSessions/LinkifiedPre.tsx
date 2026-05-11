import { useEffect, useMemo, useRef } from "react";
import { attachExternalLinkDelegation } from "../../services/openExternal";

function escapeHtmlPlain(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyEscapedPlain(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<&]+/gi, (raw) => {
    const href = raw.replace(/[),.;!?]+$/g, "");
    if (!/^https?:\/\//i.test(href)) return raw;
    try {
      new URL(href);
    } catch {
      return raw;
    }
    return `<a href="${escapeHtmlPlain(href)}" rel="noopener noreferrer" class="app-markdown-link">${raw}</a>`;
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
