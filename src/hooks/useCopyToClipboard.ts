import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_RESET_MS = 1500;

export function useCopyToClipboard(resetMs = DEFAULT_RESET_MS) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      try {
        await navigator.clipboard.writeText(trimmed);
        setCopied(true);
        if (resetTimerRef.current != null) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          resetTimerRef.current = null;
        }, resetMs);
        return true;
      } catch {
        message.error("复制失败");
        return false;
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
