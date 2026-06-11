import { useEffect, useMemo, useRef } from "react";
import { message } from "antd";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { isValidHttpUrl, normalizeAutolinkUrl } from "../../utils/autolinkUrl";
import {
  sanitizeRichMessageHtml,
  splitRichMessageContent,
} from "../../utils/richMessageHtml";
import { normalizeMarkdownForDisplay } from "../../utils/markdownDisplayNormalize";

// ── Markdown Renderer ──

marked.use({ gfm: true, breaks: true });

const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z"/></svg>';
const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M5 12l3.38 2.79L15 5.83"/></svg>';

function tryDecodeUriForDisplay(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text: string) {
  try {
    const normalized = normalizeMarkdownForDisplay(text);
    const html = marked.parse(normalized, { breaks: true, gfm: true });
    if (typeof html !== "string") return "";
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true },
      FORBID_TAGS: ["style", "script"],
    });
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
}

function renderRichMessageInnerHtml(text: string): string {
  const split = splitRichMessageContent(text);
  if (split.kind === "markdown") {
    return renderMarkdown(split.markdown);
  }
  if (split.kind === "html") {
    return `<div class="app-markdown-html-embed">${sanitizeRichMessageHtml(split.html)}</div>`;
  }
  const mdHtml = split.markdown ? renderMarkdown(split.markdown) : "";
  const docHtml = sanitizeRichMessageHtml(split.html);
  const embed = docHtml
    ? `<div class="app-markdown-html-embed">${docHtml}</div>`
    : "";
  return `${mdHtml}${embed}`;
}

/** 同步构建 Markdown HTML，避免 ref + useEffect 时序导致正文未写入 DOM。 */
export function buildMarkdownDisplayHtml(text: string): string {
  if (!text.trim()) return "";
  const html = renderRichMessageInnerHtml(text);
  const temp = document.createElement("div");
  temp.innerHTML = html;

  temp.querySelectorAll("pre").forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "app-markdown-code";
    const copyBtn = document.createElement("button");
    copyBtn.className = "app-markdown-copy-btn";
    copyBtn.setAttribute("aria-label", "复制");
    copyBtn.setAttribute("data-tooltip", "复制");
    copyBtn.innerHTML = `<span class="copy-icon">${COPY_ICON}</span><span class="check-icon">${CHECK_ICON}</span>`;
    const parent = pre.parentElement;
    if (parent) {
      parent.replaceChild(wrapper, pre);
      wrapper.appendChild(pre);
      wrapper.appendChild(copyBtn);
    }
  });

  temp.querySelectorAll(":not(pre) > code").forEach((code) => {
    const raw = code.textContent?.trim() ?? "";
    const href = normalizeAutolinkUrl(raw);
    if (href && /^https?:\/\//i.test(href) && isValidHttpUrl(href)) {
      try {
        const url = new URL(href);
        const link = document.createElement("a");
        link.href = url.toString();
        link.className = "app-markdown-link";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        code.textContent = href;
        code.parentNode?.replaceChild(link, code);
        link.appendChild(code);
      } catch { /* ignore */ }
    }
  });

  temp.querySelectorAll("a[href]").forEach((anchor) => {
    const rawHref = anchor.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(rawHref)) {
      const href = normalizeAutolinkUrl(rawHref);
      if (isValidHttpUrl(href)) {
        anchor.setAttribute("href", href);
        const anchorText = anchor.textContent ?? "";
        if (anchorText === rawHref || anchorText === tryDecodeUriForDisplay(rawHref)) {
          anchor.textContent = href;
        } else if (anchorText.startsWith(rawHref)) {
          anchor.textContent = href + anchorText.slice(rawHref.length);
        }
      }
    }
    anchor.classList.add("app-markdown-link");
    if (!anchor.getAttribute("target")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  });

  return temp.innerHTML;
}

export function StreamingReplyHint() {
  return (
    <div className="app-markdown-streaming-hint" role="status" aria-live="polite" aria-label="正在生成回复">
      <span className="app-markdown-streaming-hint__pulse" aria-hidden />
      <span className="app-markdown-streaming-hint__label">正在思考</span>
      <span className="app-markdown-streaming-hint__dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

interface Props {
  text: string;
  streaming?: boolean;
  /** 是否展示底部「正在思考」提示；默认与 streaming 相同 */
  showPendingHint?: boolean;
  className?: string;
}

export function Markdown({ text, streaming, showPendingHint, className }: Props) {
  const showHint = showPendingHint ?? Boolean(streaming);
  const containerRef = useRef<HTMLDivElement>(null);
  const copyTimeoutsRef = useRef<Map<HTMLButtonElement, ReturnType<typeof setTimeout>>>(new Map());
  const displayHtml = useMemo(() => buildMarkdownDisplayHtml(text), [text]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleCopyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const copyBtn = target.closest(".app-markdown-copy-btn") as HTMLButtonElement | null;
      if (!copyBtn || !container.contains(copyBtn)) return;

      const wrapper = copyBtn.closest(".app-markdown-code");
      const code = wrapper?.querySelector("code");
      if (!code) return;

      navigator.clipboard
        .writeText(code.textContent ?? "")
        .then(() => {
          copyBtn.setAttribute("data-copied", "true");
          copyBtn.setAttribute("data-tooltip", "已复制");
          const existing = copyTimeoutsRef.current.get(copyBtn);
          if (existing) clearTimeout(existing);
          const t = setTimeout(() => {
            copyBtn.removeAttribute("data-copied");
            copyBtn.setAttribute("data-tooltip", "复制");
            copyTimeoutsRef.current.delete(copyBtn);
          }, 2000);
          copyTimeoutsRef.current.set(copyBtn, t);
        })
        .catch(() => message.error("复制失败"));
    };

    container.addEventListener("click", handleCopyClick);
    const linkUnsub = attachExternalLinkDelegation(container);

    return () => {
      container.removeEventListener("click", handleCopyClick);
      if (linkUnsub) linkUnsub();
    };
  }, [displayHtml]);

  useEffect(() => {
    return () => {
      copyTimeoutsRef.current.forEach((t) => clearTimeout(t));
      copyTimeoutsRef.current.clear();
    };
  }, []);

  const isContinuation = text.includes("This session is being continued from a previous conversation");

  return (
    <div className={`app-markdown-host${showHint ? " app-markdown-host--streaming" : ""}${isContinuation ? " app-markdown-host--continuation" : ""}`}>
      <div
        ref={containerRef}
        className={`app-markdown ${className ?? ""}`}
        {...(displayHtml ? { dangerouslySetInnerHTML: { __html: displayHtml } } : {})}
      />
      {showHint && <StreamingReplyHint />}
    </div>
  );
}

/** @deprecated 流式期间曾用于打字机效果；现直接返回全文以避免叠加 setState 与 Markdown 重绘。 */
export function usePacedText(text: string, _streaming?: boolean): string {
  return text;
}
