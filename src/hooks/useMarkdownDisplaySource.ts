import { useDeferredValue, useMemo, useRef, useSyncExternalStore } from "react";
import {
  coerceMarkdownSourceText,
  prepareMarkdownForDisplay,
  stabilizeStreamingMarkdown,
} from "../utils/markdownRenderPipeline";
import {
  containsStreamingHtmlMarkup,
  normalizeInlineHtmlBreakTags,
} from "../utils/markdownDisplayNormalize";
import { findHtmlDocumentStartIndex } from "../utils/richMessageHtml";
import {
  isMainThreadCongested,
  subscribeMainThreadCongestion,
} from "../stores/mainThreadCongestionStore";

/** 流式 Markdown 重建最短间隔：偏短以提升贴底展示流畅度；拥堵时仍由 defer 路径让步。 */
const STREAMING_MIN_REBUILD_MS = 100;
const STREAMING_MIN_REBUILD_CONGESTED_MS = 220;
/** 超长正文放宽重建间隔，抵消每 tick 全量重解析的成本（替代此前的纯文本降级）。 */
const STREAMING_MIN_REBUILD_LARGE_MS = 240;
const STREAMING_LARGE_TEXT_CHARS = 6000;
const STREAMING_SHORT_TEXT_FAST_PATH_LIMIT = 600;
/**
 * 流式纯文本兜底阈值：仅在主线程已拥堵且正文极长时启用。
 * 表格、代码围栏等重结构不再降级——降级期间用户看到的是裸源码（`| a | b |`、
 * ``` 围栏、`###` 等），要等流式收尾才变成表格，观感即「先乱码、后正常」。
 */
const STREAMING_PLAIN_DEGRADE_CHARS = 20000;
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

/**
 * 流式期是否放弃 Markdown 结构、直出纯文本。
 * 只在主线程已经拥堵、且正文长到重解析明显伤帧率时才成立。
 */
export function shouldDegradeStreamingToPlain(text: string, congested: boolean): boolean {
  return congested && text.length >= STREAMING_PLAIN_DEGRADE_CHARS;
}

/** 流式重建节流间隔：拥堵优先让步，其次按正文规模放宽。 */
export function resolveStreamingRebuildMinMs(textLength: number, congested: boolean): number {
  if (congested) return STREAMING_MIN_REBUILD_CONGESTED_MS;
  if (textLength >= STREAMING_LARGE_TEXT_CHARS) return STREAMING_MIN_REBUILD_LARGE_MS;
  return STREAMING_MIN_REBUILD_MS;
}

function subscribeCongestionAlways(onStoreChange: () => void): () => void {
  return subscribeMainThreadCongestion(onStoreChange);
}

export type MarkdownDisplaySourceResult = {
  source: string;
  /** 流式降级：宿主应渲染纯文本，跳过 ReactMarkdown。 */
  plain: boolean;
};

/** 构建聊天 Markdown 展示源码（预处理后交给 ReactMarkdown）。 */
export function useMarkdownDisplaySource(text: string, streaming: boolean): MarkdownDisplaySourceResult {
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

  const lastBuiltRef = useRef<{ text: string; source: string; plain: boolean; at: number }>({
    text: "",
    source: "",
    plain: false,
    at: 0,
  });
  const wasStreamingRef = useRef(streaming);

  return useMemo(() => {
    if (wasStreamingRef.current && !streaming) {
      lastBuiltRef.current = { text: "", source: "", plain: false, at: 0 };
    }
    wasStreamingRef.current = streaming;

    if (!stabilizedText.trim()) {
      lastBuiltRef.current = { text: stabilizedText, source: "", plain: false, at: performance.now() };
      return { source: "", plain: false };
    }

    if (!streaming) {
      const source = prepareMarkdownForDisplay(stabilizedText, { streaming: false });
      lastBuiltRef.current = { text: stabilizedText, source, plain: false, at: performance.now() };
      return { source, plain: false };
    }

    const prev = lastBuiltRef.current;
    const now = performance.now();
    const rebuildMinMs = resolveStreamingRebuildMinMs(stabilizedText.length, congested);
    const degradeToPlain = shouldDegradeStreamingToPlain(stabilizedText, congested);
    const withinThrottle =
      prev.text
      && stabilizedText.startsWith(prev.text)
      && prev.source
      && prev.plain === degradeToPlain
      && now - prev.at < rebuildMinMs
      && !shouldBypassStreamingRebuildThrottle(stabilizedText);
    if (withinThrottle) {
      return { source: prev.source, plain: prev.plain };
    }

    if (degradeToPlain) {
      const plainSource = normalizeInlineHtmlBreakTags(stabilizedText);
      lastBuiltRef.current = { text: stabilizedText, source: plainSource, plain: true, at: now };
      return { source: plainSource, plain: true };
    }

    if (streamingShortTextFastPath(stabilizedText)) {
      return { source: normalizeInlineHtmlBreakTags(stabilizedText), plain: false };
    }

    const source = prepareMarkdownForDisplay(stabilizedText, { streaming: true });
    lastBuiltRef.current = { text: stabilizedText, source, plain: false, at: now };
    return { source, plain: false };
  }, [stabilizedText, streaming, congested]);
}
