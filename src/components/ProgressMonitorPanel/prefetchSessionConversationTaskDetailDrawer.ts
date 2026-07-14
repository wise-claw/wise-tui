import { composerRegionChunk } from "../ClaudeSessions/ClaudeChatComposerTray";
import { prefetchModule } from "../../utils/prefetchModule";

/** 悬停 / pointerdown / 面板展开时预热派发详情 drawer 输入区 chunk。 */
export function prefetchSessionConversationTaskDetailDrawer(): void {
  prefetchModule(() => composerRegionChunk, "composer-region");
}
