/** 在浏览器空闲时再执行，避免与首屏/切 tab 争抢主线程。 */
export function runWhenIdle(task: () => void, options?: { timeoutMs?: number }): () => void {
  if (typeof requestIdleCallback === "undefined") {
    const timer = window.setTimeout(task, 120);
    return () => window.clearTimeout(timer);
  }
  const id = requestIdleCallback(task, { timeout: options?.timeoutMs ?? 2500 });
  return () => cancelIdleCallback(id);
}
