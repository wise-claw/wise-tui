import { useDeferredValue, useMemo, useRef, useSyncExternalStore } from "react";
import {
  coerceMarkdownSourceText,
  prepareMarkdownForDisplay,
  stabilizeStreamingMarkdown,
} from "../utils/markdownRenderPipeline";
import { containsStreamingHtmlMarkup } from "../utils/markdownDisplayNormalize";
import { findHtmlDocumentStartIndex } from "../utils/richMessageHtml";
import {
  isMainThreadCongested,
  subscribeMainThreadCongestion,
} from "../stores/mainThreadCongestionStore";

/** 流式 Markdown 重建最短间隔：偏短以提升贴底展示流畅度；拥堵时仍由 defer 路径让步。 */
const STREAMING_MIN_REBUILD_MS = 100;
const STREAMING_MIN_REBUILD_CONGESTED_MS = 220;
const STREAMING_SHORT_TEXT_FAST_PATH_LIMIT = 600;
const MARKDOWN_STRUCTURE_HINT_RE = /[<|`#>*\-\|\uFF5C]|\]\(|!\[|^\s*\d+\.\s/m;

function shouldBypassStreamingRebuildThrottle(text: string): boolean {
  if (findHtmlDocumentStartIndex(text) !== null) return true;
  return containsStreamingHtmlMarkup(text);
}

/**
 * 流式短累积快速路径：跳过 `prepareMarkdownForDisplay` 的 11 个全文规范化 pass，
 * 直接交由 ReactMarkdown 解析原文。命中时省下每 tick 的 O(n) × 11 正则扫描。
 * 触发后 `lastBuiltRef` 不写 source，下次累积超阈值或 throttle 到期会落回完整规范化。
 *
 * 兜底：含 ASCII `----+---+` 簇的"塌成一行"pipe table 也需走完整归一化。
 */
const COLLAPSED_PIPE_TABLE_FAST_PATH_GUARD = /[-+]{3,}/;

function streamingShortTextFastPath(text: string): boolean {
  if (text.length >= STREAMING_SHORT_TEXT_FAST_PATH_LIMIT) return false;
  if (COLLAPSED_PIPE_TABLE_FAST_PATH_GUARD.test(text)) return false;
  // 多段纯文本也需完整 normalize，与磁盘态段间距/列表结构对齐。
  if (text.split(/\n\s*\n/).filter((block) => block.trim()).length >= 2) return false;
  return !MARKDOWN_STRUCTURE_HINT_RE.test(text);
}

function subscribeCongestionAlways(onStoreChange: () => void): () => void {
  return subscribeMainThreadCongestion(onStoreChange);
}

/** 构建聊天 Markdown 展示源码（预处理后交给 ReactMarkdown）。 */
export function useMarkdownDisplaySource(text: string, streaming: boolean): string {
  const safeText = coerceMarkdownSourceText(text);
  const congested = useSyncExternalStore(
    subscribeCongestionAlways,
    isMainThreadCongested,
    () => false,
  );
  const deferredText = useDeferredValue(safeText);
  // 流式默认即时渲染，避免 useDeferredValue 叠 thrrottle 造成「顿一下才出字」；
  // 仅主线程拥堵时改走 deferred，优先保证滚动/输入响应。
  const renderText = streaming && congested ? deferredText : safeText;
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
    const rebuildMinMs = congested ? STREAMING_MIN_REBUILD_CONGESTED_MS : STREAMING_MIN_REBUILD_MS;
    const withinThrottle =
      prev.text
      && stabilizedText.startsWith(prev.text)
      && prev.source
      && now - prev.at < rebuildMinMs
      && !shouldBypassStreamingRebuildThrottle(stabilizedText);
    if (withinThrottle) {
      return prev.source;
    }

    if (streamingShortTextFastPath(stabilizedText)) {
      return stabilizedText;
    }

    const source = prepareMarkdownForDisplay(stabilizedText, { streaming: true });
    lastBuiltRef.current = { text: stabilizedText, source, at: now };
    return source;
  }, [stabilizedText, streaming, congested]);
}
