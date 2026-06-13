import { useDeferredValue, useMemo, useRef } from "react";
import {
  coerceMarkdownSourceText,
  prepareMarkdownForDisplay,
  stabilizeStreamingMarkdown,
} from "../utils/markdownRenderPipeline";
import { containsStreamingHtmlMarkup } from "../utils/markdownDisplayNormalize";
import { findHtmlDocumentStartIndex } from "../utils/richMessageHtml";

const STREAMING_MIN_REBUILD_MS = 96;

function shouldBypassStreamingRebuildThrottle(text: string): boolean {
  if (findHtmlDocumentStartIndex(text) !== null) return true;
  return containsStreamingHtmlMarkup(text);
}

/** 构建聊天 Markdown 展示源码（预处理后交给 ReactMarkdown）。 */
export function useMarkdownDisplaySource(text: string, streaming: boolean): string {
  const safeText = coerceMarkdownSourceText(text);
  const deferredText = useDeferredValue(safeText);
  const renderText = streaming ? deferredText : safeText;
  const stabilizedText = useMemo(
    () => (streaming ? stabilizeStreamingMarkdown(renderText) : renderText),
    [renderText, streaming],
  );

  const lastBuiltRef = useRef<{ text: string; source: string; at: number }>({
    text: "",
    source: "",
    at: 0,
  });
  const wasStreamingRef = useRef(streaming);

  return useMemo(() => {
    if (wasStreamingRef.current && !streaming) {
      lastBuiltRef.current = { text: "", source: "", at: 0 };
    }
    wasStreamingRef.current = streaming;

    if (!stabilizedText.trim()) {
      lastBuiltRef.current = { text: "", source: "", at: performance.now() };
      return "";
    }

    if (!streaming) {
      const source = prepareMarkdownForDisplay(stabilizedText, { streaming: false });
      lastBuiltRef.current = { text: stabilizedText, source, at: performance.now() };
      return source;
    }

    const prev = lastBuiltRef.current;
    const now = performance.now();
    if (
      prev.text
      && stabilizedText.startsWith(prev.text)
      && prev.source
      && now - prev.at < STREAMING_MIN_REBUILD_MS
      && !shouldBypassStreamingRebuildThrottle(stabilizedText)
    ) {
      return prev.source;
    }

    const source = prepareMarkdownForDisplay(stabilizedText, { streaming: true });
    lastBuiltRef.current = { text: stabilizedText, source, at: now };
    return source;
  }, [stabilizedText, streaming]);
}
