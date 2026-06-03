import { Spin } from "antd";
import { lazy, Suspense, memo, type RefObject } from "react";
import type { ComposerRegionProps } from "../ClaudeChatInput";
import { BackgroundInvocationDock } from "./BackgroundInvocationDock";

/** Semi AIChatInput（Tiptap/ProseMirror）与聊天输入区同 chunk，按需加载。 */
export const composerRegionChunk = import("../ClaudeChatInput/composer-region");

const ComposerRegionLazy = lazy(() =>
  composerRegionChunk.then((module) => ({ default: module.ComposerRegion })),
);

export interface ClaudeChatComposerTrayProps extends ComposerRegionProps {
  composerTrayRef: RefObject<HTMLDivElement | null>;
  backgroundInvocationDockEnabled: boolean;
}

export const ClaudeChatComposerTray = memo(function ClaudeChatComposerTray({
  composerTrayRef,
  backgroundInvocationDockEnabled,
  session,
  ...composerProps
}: ClaudeChatComposerTrayProps) {
  return (
    <div ref={composerTrayRef} className="app-claude-composer-tray">
      <BackgroundInvocationDock session={session} enabled={backgroundInvocationDockEnabled} />
      <Suspense
        fallback={
          <div className="app-claude-composer-tray__loading" aria-busy="true" aria-label="输入区加载中">
            <Spin size="small" />
          </div>
        }
      >
        <ComposerRegionLazy session={session} {...composerProps} />
      </Suspense>
    </div>
  );
});
