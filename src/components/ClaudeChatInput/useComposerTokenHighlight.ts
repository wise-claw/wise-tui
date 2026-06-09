import { useCallback, useEffect, useRef } from "react";
import type { AIChatInput } from "@douyinfe/semi-ui";
import {
  detachComposerTokenHighlightPlugin,
  ensureComposerTokenHighlightPlugin,
} from "./composerTokenHighlight";
import type { Plugin } from "@tiptap/pm/state";

/** 为 Semi Tiptap 编辑器注入 @ / 指令 token 高亮装饰。 */
export function useComposerTokenHighlight(
  aiChatRef: React.RefObject<InstanceType<typeof AIChatInput> | null>,
  enabled: boolean,
  sessionKey: string,
  /** prompt 同步键：Semi setContent 会重建 editor，需在内容回写后重新挂载插件。 */
  plainSyncKey?: string,
): void {
  const pluginRef = useRef<Plugin | null>(null);

  const ensureAttached = useCallback(() => {
    const editor = aiChatRef.current?.getEditor?.();
    if (!editor) return false;
    pluginRef.current = ensureComposerTokenHighlightPlugin(editor);
    return pluginRef.current != null;
  }, [aiChatRef]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryAttach = (attempt = 0) => {
      if (cancelled) return;
      if (ensureAttached()) return;
      if (attempt < 12) {
        retryTimer = setTimeout(() => tryAttach(attempt + 1), 32);
      }
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      const editor = aiChatRef.current?.getEditor?.();
      detachComposerTokenHighlightPlugin(editor, pluginRef.current);
      pluginRef.current = null;
    };
  }, [aiChatRef, enabled, ensureAttached, sessionKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    const frameId = requestAnimationFrame(() => {
      ensureAttached();
    });
    return () => cancelAnimationFrame(frameId);
  }, [enabled, ensureAttached, plainSyncKey]);
}
