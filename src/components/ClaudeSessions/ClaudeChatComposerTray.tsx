import { memo, type RefObject } from "react";
import { ComposerRegion, type ComposerRegionProps } from "../ClaudeChatInput";
import { BackgroundInvocationDock } from "./BackgroundInvocationDock";

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
      <ComposerRegion session={session} {...composerProps} />
    </div>
  );
});
