export type ClaudeChatMessageScrollBridge = {
  scrollToSessionMessageId: (messageId: number) => void;
  scrollMessageTargetIntoView: (target: Element | null) => boolean;
};

const noopBridge: ClaudeChatMessageScrollBridge = {
  scrollToSessionMessageId: () => {},
  scrollMessageTargetIntoView: () => false,
};

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
