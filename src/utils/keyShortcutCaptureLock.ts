/** 配置页正在录制快捷键时，避免其它全局快捷键抢键。 */

let listeningDepth = 0;
const listeners = new Set<() => void>();

function notifyKeyShortcutCaptureLock(): void {
  for (const listener of listeners) listener();
}

export function beginKeyShortcutCapture(): void {
  const wasListening = listeningDepth > 0;
  listeningDepth += 1;
  if (!wasListening) notifyKeyShortcutCaptureLock();
}

export function endKeyShortcutCapture(): void {
  const wasListening = listeningDepth > 0;
  listeningDepth = Math.max(0, listeningDepth - 1);
  if (wasListening && listeningDepth === 0) notifyKeyShortcutCaptureLock();
}

export function isKeyShortcutCaptureListening(): boolean {
  return listeningDepth > 0;
}

export function subscribeKeyShortcutCaptureLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试重置。 */
export function resetKeyShortcutCaptureLockForTests(): void {
  listeningDepth = 0;
  listeners.clear();
}
