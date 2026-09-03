export interface PointerClickGate {
  tryInvoke: (action: () => void) => boolean;
  reset: () => void;
}

/**
 * 把一次指针手势里的 pointerdown + click 收成单次触发。
 * 锁持续到当前事件队列之后（setTimeout 0），以便 click 仍能看到锁；
 * 若 isBlocked 仍为 true（例如父级 creating 标志），则保持锁定直到 reset。
 */
export function createPointerClickGate(options?: {
  isBlocked?: () => boolean;
}): PointerClickGate {
  let locked = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;

  const clearUnlockTimer = (): void => {
    if (unlockTimer == null) return;
    clearTimeout(unlockTimer);
    unlockTimer = null;
  };

  const scheduleUnlock = (): void => {
    clearUnlockTimer();
    unlockTimer = setTimeout(() => {
      unlockTimer = null;
      if (options?.isBlocked?.()) return;
      locked = false;
    }, 0);
  };

  return {
    tryInvoke(action) {
      if (locked || options?.isBlocked?.()) return false;
      locked = true;
      action();
      scheduleUnlock();
      return true;
    },
    reset() {
      clearUnlockTimer();
      locked = false;
    },
  };
}
