/**
 * 终端容器布局辅助：等待尺寸稳定后再 open/resize PTY。
 */

export function terminalLayoutReady(container: HTMLElement): boolean {
  return container.clientWidth > 8 && container.clientHeight > 8;
}

export function waitForTerminalContainerLayout(
  container: HTMLElement,
  timeoutMs = 5000,
): Promise<void> {
  if (terminalLayoutReady(container)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve();
    };

    const observer = new ResizeObserver(() => {
      if (terminalLayoutReady(container)) {
        finish();
      }
    });
    observer.observe(container);

    const poll = () => {
      if (terminalLayoutReady(container)) {
        finish();
        return;
      }
      if (Date.now() >= deadline) {
        finish();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

export async function waitForTerminalContainerStableLayout(
  container: HTMLElement,
  options?: { timeoutMs?: number; stableFrames?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const stableFrames = Math.max(1, options?.stableFrames ?? 3);
  await waitForTerminalContainerLayout(container, timeoutMs);

  const deadline = Date.now() + timeoutMs;
  let lastW = container.clientWidth;
  let lastH = container.clientHeight;
  let stableCount = 0;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === lastW && h === lastH && terminalLayoutReady(container)) {
      stableCount += 1;
      if (stableCount >= stableFrames) return;
    } else {
      stableCount = 0;
      lastW = w;
      lastH = h;
    }
  }
}
