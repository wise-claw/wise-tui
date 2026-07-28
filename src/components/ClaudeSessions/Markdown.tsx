import { useEffect, useLayoutEffect, useRef } from "react";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { attachWiseLinkDelegation } from "../../services/wiseUiNavigation";
import { useMarkdownDisplaySource } from "../../hooks/useMarkdownDisplaySource";
import { coerceMarkdownSourceText } from "../../utils/markdownRenderPipeline";
import { renderMermaidInContainer } from "../../utils/mermaidRender";
import { attachMermaidViewerInteractions } from "../../utils/mermaidViewerUi";
import { MarkdownBody } from "./MarkdownElements";

export { buildMarkdownDisplayHtml, clearMarkdownDisplayHtmlCache, prepareMarkdownForDisplay } from "../../utils/markdownRenderPipeline";

/** 思考态指示图标：灯泡轮廓，用于「思考中」文案前。 */
export function ThinkingHintIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.9.96 3.58 2.42 4.56L6 18h12l-.42-5.94A5.49 5.49 0 0 0 20 7.5 5.5 5.5 0 0 0 14.5 2h-5Z" />
      <path d="M9 18v1.5a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15 19.5V18" />
      <path d="M10 14h4" />
    </svg>
  );
}

export function StreamingReplyHint() {
  return (
    <div className="app-markdown-streaming-hint" role="status" aria-live="polite" aria-label="思考中">
      <span className="app-markdown-streaming-hint__icon app-thinking-hint-icon--active" aria-hidden>
        <ThinkingHintIcon />
      </span>
      <span className="app-markdown-streaming-hint__label app-status-text-shimmer">思考中</span>
    </div>
  );
}

interface Props {
  text: string;
  streaming?: boolean;
  showPendingHint?: boolean;
  className?: string;
}

export function Markdown({ text, streaming, showPendingHint, className }: Props) {
  const safeText = coerceMarkdownSourceText(text);
  const isStreaming = Boolean(streaming);
  const showHint = showPendingHint ?? isStreaming;
  const containerRef = useRef<HTMLDivElement>(null);
  const { source: displaySource, plain: streamingPlain } = useMarkdownDisplaySource(safeText, isStreaming);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || isStreaming || !displaySource || streamingPlain) return;

    let cancelled = false;
    void renderMermaidInContainer(container).finally(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [displaySource, isStreaming, streamingPlain]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const linkUnsub = attachExternalLinkDelegation(container);
    const wiseLinkUnsub = attachWiseLinkDelegation(container);
    const mermaidUnsub = attachMermaidViewerInteractions(container);

    return () => {
      if (linkUnsub) linkUnsub();
      wiseLinkUnsub();
      mermaidUnsub();
    };
  }, [displaySource]);

  const isContinuation = safeText.includes("This session is being continued from a previous conversation");

  return (
    <div
      className={`app-markdown-host${showHint ? " app-markdown-host--streaming" : ""}${isContinuation ? " app-markdown-host--continuation" : ""}`}
    >
      <div ref={containerRef} className={`app-markdown ${className ?? ""}`} suppressHydrationWarning>
        {displaySource ? (
          streamingPlain ? (
            <pre className="app-markdown-streaming-plain">{displaySource}</pre>
          ) : (
            <MarkdownBody source={displaySource} streaming={isStreaming} />
          )
        ) : null}
      </div>
      {showHint && <StreamingReplyHint />}
    </div>
  );
}

/** @deprecated 流式期间曾用于打字机效果；现直接返回全文以避免叠加 setState 与 Markdown 重绘。 */
export function usePacedText(text: string, _streaming?: boolean): string {
  return text;
}
