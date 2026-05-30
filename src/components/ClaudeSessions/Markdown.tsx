import { useState, useEffect, useRef, useCallback } from "react";
import { message } from "antd";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { attachExternalLinkDelegation } from "../../services/openExternal";

// ── Markdown Renderer ──

const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z"/></svg>';
const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M5 12l3.38 2.79L15 5.83"/></svg>';

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
    const html = marked.parse(text, { breaks: true, gfm: true });
    if (typeof html !== "string") return "";
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true },
      FORBID_TAGS: ["style", "script"],
    });
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
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
  const renderRafRef = useRef<number | null>(null);

  const lastRenderedTextRef = useRef<string | null>(null);

  const updateDOM = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!text) {
      if (lastRenderedTextRef.current !== "") {
        container.innerHTML = "";
        lastRenderedTextRef.current = "";
      }
      return;
    }

    // 内容未变时跳过完整的 marked+DOMPurify+DOM 管线
    if (text === lastRenderedTextRef.current) return;

    const html = renderMarkdown(text);
    const temp = document.createElement("div");
    temp.innerHTML = html;

    // Wrap code blocks
    const pres = temp.querySelectorAll("pre");
    pres.forEach((pre) => {
      const wrapper = document.createElement("div");
      wrapper.className = "app-markdown-code";
      const copyBtn = document.createElement("button");
      copyBtn.className = "app-markdown-copy-btn";
      copyBtn.setAttribute("aria-label", "复制");
      copyBtn.setAttribute("data-tooltip", "复制");
      copyBtn.innerHTML = `<span class="copy-icon">${COPY_ICON}</span><span class="check-icon">${CHECK_ICON}</span>`;
      copyBtn.addEventListener("click", () => {
        const code = wrapper.querySelector("code");
        if (!code) return;
        navigator.clipboard
          .writeText(code.textContent ?? "")
          .then(() => {
            message.success("已复制到剪贴板");
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
      });
      const parent = pre.parentElement;
      if (parent) {
        parent.replaceChild(wrapper, pre);
        wrapper.appendChild(pre);
        wrapper.appendChild(copyBtn);
      }
    });

    // Convert URL-like inline code to links
    const inlineCodes = temp.querySelectorAll(":not(pre) > code");
    inlineCodes.forEach((code) => {
      const href = code.textContent?.trim().replace(/[),.;!?]+$/, "");
      if (href && /^https?:\/\//.test(href)) {
        try {
          const url = new URL(href);
          const link = document.createElement("a");
          link.href = url.toString();
          link.className = "app-markdown-link";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          code.parentNode?.replaceChild(link, code);
          link.appendChild(code);
        } catch { /* ignore */ }
      }
    });

    temp.querySelectorAll("a[href]").forEach((anchor) => {
      anchor.classList.add("app-markdown-link");
      if (!anchor.getAttribute("target")) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }
    });

    // 直接移动子节点而非序列化/反序列化 innerHTML，减少一次完整 DOM 克隆开销
    container.replaceChildren(...temp.childNodes);
    lastRenderedTextRef.current = text;
  }, [text]);

  useEffect(() => {
    if (renderRafRef.current != null) {
      window.cancelAnimationFrame(renderRafRef.current);
    }
    renderRafRef.current = window.requestAnimationFrame(() => {
      renderRafRef.current = null;
      updateDOM();
    });
    return () => {
      if (renderRafRef.current != null) {
        window.cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
    };
  }, [updateDOM]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachExternalLinkDelegation(container);
  }, []);

  useEffect(() => {
    return () => {
      copyTimeoutsRef.current.forEach((t) => clearTimeout(t));
      copyTimeoutsRef.current.clear();
    };
  }, []);


  const isContinuation = text.includes("This session is being continued from a previous conversation");

  return (
    <div className={`app-markdown-host${showHint ? " app-markdown-host--streaming" : ""}${isContinuation ? " app-markdown-host--continuation" : ""}`}>
      <div ref={containerRef} className={`app-markdown ${className ?? ""}`} />
      {showHint && <StreamingReplyHint />}
    </div>
  );
}

// ── Paced Text (streaming pacing) ──

const PACE_MS = 40;
const SNAP_RE = /[\s.,!?;:)\]]/;

function paceStep(remaining: number) {
  if (remaining <= 12) return 2;
  if (remaining <= 48) return 4;
  if (remaining <= 96) return 8;
  return Math.min(24, Math.ceil(remaining / 8));
}

function paceNext(text: string, start: number) {
  const end = Math.min(text.length, start + paceStep(text.length - start));
  const max = Math.min(text.length, end + 8);
  for (let i = end; i < max; i++) {
    if (SNAP_RE.test(text[i] ?? "")) return i + 1;
  }
  return end;
}

export function usePacedText(text: string, streaming: boolean) {
  const [shown, setShown] = useState(text);
  const shownRef = useRef(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback((t: string) => {
    shownRef.current = t;
    setShown(t);
  }, []);

  const tick = useCallback(() => {
    timeoutRef.current = null;
    const full = text;
    if (!streaming) { sync(full); return; }
    if (!full.startsWith(shownRef.current) || full.length <= shownRef.current.length) { sync(full); return; }
    const end = paceNext(full, shownRef.current.length);
    sync(full.slice(0, end));
    if (end < full.length) timeoutRef.current = setTimeout(tick, PACE_MS);
  }, [text, streaming, sync]);

  useEffect(() => {
    if (!streaming) { timeoutRef.current && clearTimeout(timeoutRef.current); sync(text); return; }
    if (!text.startsWith(shownRef.current) || text.length < shownRef.current.length) {
      timeoutRef.current && clearTimeout(timeoutRef.current);
      sync(text);
      return;
    }
    if (text.length > shownRef.current.length && !timeoutRef.current) {
      timeoutRef.current = setTimeout(tick, PACE_MS);
    }
  }, [text, streaming, sync, tick]);

  useEffect(() => {
    return () => { timeoutRef.current && clearTimeout(timeoutRef.current); };
  }, []);

  return shown;
}
