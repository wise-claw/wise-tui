import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { CHAT_MESSAGE_LIST_SCROLL_LOAD_PX } from "../constants/claudeMessageList";

export interface DiskTranscriptScrollLoadOptions {
  sessionId: string;
  diskTranscriptPartial: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  fullTranscriptLoading: boolean;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void> | Promise<boolean>;
  onFullTranscriptStart: () => void;
  onFullTranscriptEnd: () => void;
}

export function shouldTriggerDiskTranscriptScrollLoad(input: {
  scrollTop: number;
  diskTranscriptPartial: boolean;
  isLoading: boolean;
  thresholdPx?: number;
}): boolean {
  if (!input.diskTranscriptPartial || input.isLoading) return false;
  return input.scrollTop <= (input.thresholdPx ?? CHAT_MESSAGE_LIST_SCROLL_LOAD_PX);
}

/** 滚到列表顶部时自动从磁盘加载完整 jsonl（与尾部窗口 scroll 加载对齐）。 */
export function useDiskTranscriptScrollLoad(options: DiskTranscriptScrollLoadOptions): void {
  const loadLockedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    loadLockedRef.current = false;
  }, [options.sessionId]);

  useEffect(() => {
    const { diskTranscriptPartial, scrollContainerRef, onReloadFullDiskTranscript } = options;
    if (!diskTranscriptPartial || !onReloadFullDiskTranscript) return;
    const sc = scrollContainerRef.current;
    if (!sc) return;

    let raf = 0;

    const triggerLoad = () => {
      const opts = optionsRef.current;
      if (!opts.diskTranscriptPartial || !opts.onReloadFullDiskTranscript) return;
      if (opts.fullTranscriptLoading || loadLockedRef.current) return;

      loadLockedRef.current = true;
      opts.onFullTranscriptStart();
      void Promise.resolve(opts.onReloadFullDiskTranscript(opts.sessionId)).finally(() => {
        opts.onFullTranscriptEnd();
        loadLockedRef.current = false;
      });
    };

    const onScroll = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const latest = optionsRef.current;
        if (
          !shouldTriggerDiskTranscriptScrollLoad({
            scrollTop: sc.scrollTop,
            diskTranscriptPartial: latest.diskTranscriptPartial,
            isLoading: latest.fullTranscriptLoading || loadLockedRef.current,
          })
        ) {
          return;
        }
        triggerLoad();
      });
    };

    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sc.removeEventListener("scroll", onScroll);
      if (raf !== 0) window.cancelAnimationFrame(raf);
      loadLockedRef.current = false;
    };
  }, [
    options.diskTranscriptPartial,
    options.sessionId,
    options.scrollContainerRef,
    options.onReloadFullDiskTranscript,
  ]);
}
