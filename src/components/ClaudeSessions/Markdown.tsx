import { useEffect, useLayoutEffect, useRef } from "react";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { useMarkdownDisplaySource } from "../../hooks/useMarkdownDisplaySource";
import { coerceMarkdownSourceText } from "../../utils/markdownRenderPipeline";
import { renderMermaidInContainer } from "../../utils/mermaidRender";
import { attachMermaidViewerInteractions } from "../../utils/mermaidViewerUi";
import { MarkdownBody } from "./MarkdownElements";

export { buildMarkdownDisplayHtml, clearMarkdownDisplayHtmlCache, prepareMarkdownForDisplay } from "../../utils/markdownRenderPipeline";

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
  showPendingHint?: boolean;
  className?: string;
}

export function Markdown({ text, streaming, showPendingHint, className }: Props) {
  const safeText = coerceMarkdownSourceText(text);
  const isStreaming = Boolean(streaming);
  const showHint = showPendingHint ?? isStreaming;
  const containerRef = useRef<HTMLDivElement>(null);
  const displaySource = useMarkdownDisplaySource(safeText, isStreaming);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || isStreaming || !displaySource) return;

    let cancelled = false;
    void renderMermaidInContainer(container).finally(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [displaySource, isStreaming]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const linkUnsub = attachExternalLinkDelegation(container);
    const mermaidUnsub = attachMermaidViewerInteractions(container);

    return () => {
      if (linkUnsub) linkUnsub();
      mermaidUnsub();
    };
  }, [displaySource]);

  const isContinuation = safeText.includes("This session is being continued from a previous conversation");

  return (
    <div
      className={`app-markdown-host${showHint ? " app-markdown-host--streaming" : ""}${isContinuation ? " app-markdown-host--continuation" : ""}`}
    >
      <div ref={containerRef} className={`app-markdown ${className ?? ""}`} suppressHydrationWarning>
        {displaySource ? <MarkdownBody source={displaySource} streaming={isStreaming} /> : null}
      </div>
      {showHint && <StreamingReplyHint />}
    </div>
  );
}

/** @deprecated 流式期间曾用于打字机效果；现直接返回全文以避免叠加 setState 与 Markdown 重绘。 */
export function usePacedText(text: string, _streaming?: boolean): string {
  return text;
}
