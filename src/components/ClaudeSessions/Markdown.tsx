import { useEffect, useLayoutEffect, useRef } from "react";
import { message } from "antd";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { useMarkdownDisplayHtml } from "../../hooks/useMarkdownDisplayHtml";
import {
  coerceMarkdownSourceText,
  syncMarkdownHtmlToContainer,
} from "../../utils/markdownRenderPipeline";

export { buildMarkdownDisplayHtml, clearMarkdownDisplayHtmlCache } from "../../utils/markdownRenderPipeline";

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
  const safeText = coerceMarkdownSourceText(text);
  const isStreaming = Boolean(streaming);
  const showHint = showPendingHint ?? isStreaming;
  const containerRef = useRef<HTMLDivElement>(null);
  const copyTimeoutsRef = useRef<Map<HTMLButtonElement, ReturnType<typeof setTimeout>>>(new Map());
  const displayHtml = useMarkdownDisplayHtml(safeText, isStreaming);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    syncMarkdownHtmlToContainer(container, displayHtml);
  }, [displayHtml]);

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

  const isContinuation = safeText.includes("This session is being continued from a previous conversation");

  return (
    <div
      className={`app-markdown-host${showHint ? " app-markdown-host--streaming" : ""}${isContinuation ? " app-markdown-host--continuation" : ""}`}
    >
      <div
        ref={containerRef}
        className={`app-markdown ${className ?? ""}`}
        suppressHydrationWarning
      />
      {showHint && <StreamingReplyHint />}
    </div>
  );
}

/** @deprecated 流式期间曾用于打字机效果；现直接返回全文以避免叠加 setState 与 Markdown 重绘。 */
export function usePacedText(text: string, _streaming?: boolean): string {
  return text;
}
