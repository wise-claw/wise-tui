export type ChatScrollFileOpenAnchor = {
  scrollTop: number;
  messageId: string | null;
};

export type ClaudeChatMessageScrollBridge = {
  scrollToSessionMessageId: (messageId: number) => void;
  scrollMessageTargetIntoView: (target: Element | null) => boolean;
  pauseFollowForMessageNavigation: () => void;
};

const noopBridge: ClaudeChatMessageScrollBridge = {
  scrollToSessionMessageId: () => {},
  scrollMessageTargetIntoView: () => false,
  pauseFollowForMessageNavigation: () => {},
};

let pendingFileOpenScrollAnchor: ChatScrollFileOpenAnchor | null = null;
let fileOpenScrollLock = false;

/** 从聊天内打开文件前记住滚动位置，关闭编辑器后恢复。 */
export function rememberChatScrollBeforeFileOpen(anchor: ChatScrollFileOpenAnchor): void {
  pendingFileOpenScrollAnchor = anchor;
  fileOpenScrollLock = true;
  setClaudeChatUserPausedFollow(true);
}

export function takeChatScrollFileOpenAnchor(): ChatScrollFileOpenAnchor | null {
  const anchor = pendingFileOpenScrollAnchor;
  pendingFileOpenScrollAnchor = null;
  return anchor;
}

export function isChatScrollFileOpenLocked(): boolean {
  return fileOpenScrollLock;
}

export function clearChatScrollFileOpenLock(): void {
  fileOpenScrollLock = false;
}

let activeBridge: ClaudeChatMessageScrollBridge = noopBridge;

let userPausedFollow = false;
const userPausedFollowListeners = new Set<() => void>();

export function getClaudeChatUserPausedFollow(): boolean {
  return userPausedFollow;
}

export function subscribeClaudeChatUserPausedFollow(onStoreChange: () => void): () => void {
  userPausedFollowListeners.add(onStoreChange);
  return () => {
    userPausedFollowListeners.delete(onStoreChange);
  };
}

export function setClaudeChatUserPausedFollow(next: boolean): void {
  if (userPausedFollow === next) return;
  userPausedFollow = next;
  for (const listener of userPausedFollowListeners) {
    listener();
  }
}

export function registerClaudeChatMessageScrollBridge(
  next: ClaudeChatMessageScrollBridge,
): () => void {
  activeBridge = next;
  return () => {
    if (activeBridge === next) {
      activeBridge = noopBridge;
    }
  };
}

export function getClaudeChatMessageScrollBridge(): ClaudeChatMessageScrollBridge {
  return activeBridge;
}
