import { getAppSetting, setAppSetting } from "./appSettingsStore";

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    if (readLocal(key) !== value) globalThis.localStorage?.setItem(key, value);
  } catch {
    // 存储不可用时仍保留内存与桌面端持久化。
  }
}

/** 模型偏好的同步本地镜像；按环境合并冷启动读写，并串行落盘。 */
export function createLocalModelPreferenceCache<T extends object>(
  key: string,
  parse: (raw: string | null) => T,
) {
  let cached: T | null = null;
  let loaded = false;
  let loading: Promise<T> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const edited = new Set<keyof T>();
  const read = (): T => (cached ??= parse(readLocal(key)));
  const load = (): Promise<T> => {
    if (loaded) return Promise.resolve(read());
    if (!loading) {
      read();
      loading = Promise.resolve(getAppSetting(key)).then((raw) => {
        // 本地镜像可能比尚未完成的磁盘写入更新。其它环境的磁盘值仍须保留。
        const next = { ...parse(raw), ...read() };
        for (const field of edited) {
          if (read()[field] === undefined) delete next[field];
        }
        cached = next;
        loaded = true;
        writeLocal(key, JSON.stringify(next));
        return next;
      }).finally(() => { loading = null; });
    }
    return loading;
  };
  return {
    read,
    load,
    update<K extends keyof T>(field: K, value: T[K]): Promise<void> {
      const before = read()[field];
      if (JSON.stringify(before) === JSON.stringify(value)) return Promise.resolve();
      cached = { ...read(), [field]: value };
      if (value === undefined) delete cached[field];
      edited.add(field);
      // 显式选择立即可用于新会话，也能抵抗紧接着发生的刷新。
      writeLocal(key, JSON.stringify(cached));
      const hydration = load();
      const persist = async () => {
        await hydration;
        await setAppSetting(key, JSON.stringify(read()));
      };
      const pending = writes.then(persist, persist);
      writes = pending.catch(() => undefined);
      return pending;
    },
    reset() {
      cached = null;
      loaded = false;
      loading = null;
      writes = Promise.resolve();
      edited.clear();
    },
  };
}
