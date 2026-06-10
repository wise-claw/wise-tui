/** 返回防抖函数；`flush` 立即执行末次排队调用，`cancel` 丢弃排队调用。 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): T & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const pending = lastArgs;
      lastArgs = null;
      if (pending) fn(...pending);
    }, delayMs);
  }) as T & { flush: () => void; cancel: () => void };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      const pending = lastArgs;
      lastArgs = null;
      fn(...pending);
    }
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  return debounced;
}
