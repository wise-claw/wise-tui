import { useEffect } from "react";
import type { AIChatInput } from "@douyinfe/semi-ui";

/** @deprecated 高亮由 `composerTokenHighlightExtension` 经 AIChatInput.extensions 挂载，此 hook 不再需要。 */
export function useComposerTokenHighlight(
  _aiChatRef: React.RefObject<InstanceType<typeof AIChatInput> | null>,
  _enabled: boolean,
  _sessionKey: string,
  _plainSyncKey?: string,
): void {
  useEffect(() => {
    /* no-op: extension owns highlight lifecycle */
  }, []);
}
