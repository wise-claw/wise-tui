import { useDeferredValue, useMemo, useRef } from "react";
import {
  buildMarkdownDisplayHtml,
  coerceMarkdownSourceText,
  stabilizeStreamingMarkdown,
} from "../utils/markdownRenderPipeline";

const STREAMING_MIN_REBUILD_MS = 96;

/**
 * 构建聊天 Markdown 展示 HTML。
 * - 非流式：完整解析 + LRU 缓存
 * - 流式：useDeferredValue 降压 + 围栏稳定化 + 最短重建间隔
 */
export function useMarkdownDisplayHtml(text: string, streaming: boolean): string {
  const safeText = coerceMarkdownSourceText(text);
  const deferredText = useDeferredValue(safeText);
  const renderText = streaming ? deferredText : safeText;
  const stabilizedText = useMemo(
    () => (streaming ? stabilizeStreamingMarkdown(renderText) : renderText),
    [renderText, streaming],
  );

  const lastBuiltRef = useRef<{ text: string; html: string; at: number }>({
    text: "",
    html: "",
    at: 0,
  });

  return useMemo(() => {
    if (!stabilizedText.trim()) {
      lastBuiltRef.current = { text: "", html: "", at: performance.now() };
      return "";
    }

    if (!streaming) {
      const html = buildMarkdownDisplayHtml(stabilizedText, { streaming: false });
      lastBuiltRef.current = { text: stabilizedText, html, at: performance.now() };
      return html;
    }

    const prev = lastBuiltRef.current;
    const now = performance.now();
    if (
      prev.text
      && stabilizedText.startsWith(prev.text)
      && prev.html
      && now - prev.at < STREAMING_MIN_REBUILD_MS
    ) {
      return prev.html;
    }

    const html = buildMarkdownDisplayHtml(stabilizedText, { streaming: true });
    lastBuiltRef.current = { text: stabilizedText, html, at: now };
    return html;
  }, [stabilizedText, streaming]);
}
