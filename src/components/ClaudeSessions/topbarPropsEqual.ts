import type { TopbarProps } from "./Topbar";
import { sessionChatChromeStructureKey } from "../../utils/sessionConversationTasks";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";

function mainSessionForDataLinkEqual(
  prev: TopbarProps["mainSessionForDataLink"],
  next: TopbarProps["mainSessionForDataLink"],
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return !prev && !next;
  return sessionChatChromeStructureKey(prev) === sessionChatChromeStructureKey(next);
}

/** Topbar memo：App 壳层每帧新建回调时不重绘顶栏 chrome。 */
export function topbarPropsEqual(prev: TopbarProps, next: TopbarProps): boolean {
  if (!mainSessionForDataLinkEqual(prev.mainSessionForDataLink, next.mainSessionForDataLink)) {
    return false;
  }
  return arePropsEqualSkipping(
    { ...prev, mainSessionForDataLink: null },
    { ...next, mainSessionForDataLink: null },
    { skipKeys: ["mainSessionForDataLink"], skipFunctions: true },
  );
}
