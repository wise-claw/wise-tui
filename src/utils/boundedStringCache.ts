export interface BoundedStringCacheOptions {
  maxEntries: number;
  /** 字符总量上限；比 UTF-8 字节数更适合约束 JS 字符串堆占用。 */
  maxChars: number;
  /** 单项超过此上限时不缓存，避免一个异常大文件挤掉整个热集。 */
  maxEntryChars?: number;
  /** 键本身就是大段内容（如整段 Markdown 源）时，把键长也计入预算。 */
  countKeyChars?: boolean;
}

export interface BoundedStringCache {
  get(key: string): string | undefined;
  set(key: string, value: string): boolean;
  clear(): void;
  readonly size: number;
  readonly chars: number;
}

/** 小型 O(1) LRU，专门用于有明确内存预算的字符串缓存。 */
export function createBoundedStringCache(options: BoundedStringCacheOptions): BoundedStringCache {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries));
  const maxChars = Math.max(1, Math.floor(options.maxChars));
  const maxEntryChars = Math.max(
    1,
    Math.min(maxChars, Math.floor(options.maxEntryChars ?? maxChars)),
  );
  const countKeyChars = options.countKeyChars === true;
  const entries = new Map<string, string>();
  let chars = 0;

  const entryChars = (key: string, value: string): number =>
    value.length + (countKeyChars ? key.length : 0);

  const remove = (key: string): void => {
    const previous = entries.get(key);
    if (previous === undefined) return;
    chars -= entryChars(key, previous);
    entries.delete(key);
  };

  const evictToBudget = (): void => {
    while (entries.size > maxEntries || chars > maxChars) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      remove(oldestKey);
    }
  };

  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      // Map 插入顺序充当 LRU 顺序，命中时刷新热度。
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      remove(key);
      const size = entryChars(key, value);
      if (size > maxEntryChars) return false;
      entries.set(key, value);
      chars += size;
      evictToBudget();
      return entries.has(key);
    },
    clear() {
      entries.clear();
      chars = 0;
    },
    get size() {
      return entries.size;
    },
    get chars() {
      return chars;
    },
  };
}
