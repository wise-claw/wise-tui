import { useEffect, useRef } from "react";
import type { AIChatInput } from "@douyinfe/semi-ui";
import {
  attachComposerTokenHighlightPlugin,
  detachComposerTokenHighlightPlugin,
} from "./composerTokenHighlight";
import type { Plugin } from "@tiptap/pm/state";

/** 为 Semi Tiptap 编辑器注入 @ / 指令 token 高亮装饰。 */
export function useComposerTokenHighlight(
  aiChatRef: React.RefObject<InstanceType<typeof AIChatInput> | null>,
  enabled: boolean,
  sessionKey: string,
): void {
  const pluginRef = useRef<Plugin | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryAttach = (attempt = 0) => {
      if (cancelled) return;
      const editor = aiChatRef.current?.getEditor?.();
      if (!editor) {
        if (attempt < 12) {
          retryTimer = setTimeout(() => tryAttach(attempt + 1), 32);
        }
        return;
      }
      pluginRef.current = attachComposerTokenHighlightPlugin(editor);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      const editor = aiChatRef.current?.getEditor?.();
      detachComposerTokenHighlightPlugin(editor, pluginRef.current);
      pluginRef.current = null;
    };
  }, [aiChatRef, enabled, sessionKey]);
}
