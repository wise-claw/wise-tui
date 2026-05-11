import DOMPurify from "dompurify";
import type { Config } from "dompurify";

declare global {
  interface Window {
    __wiseDompurifyTauriAssetPatch?: boolean;
  }
}

/**
 * Milkdown Crepe 内联图片在更新 src 时会执行 `DOMPurify.sanitize(url)`（入参是纯 URL 字符串）。
 * 默认策略会去掉 `asset:` / `http://asset.*` 等非白名单协议，导致 src 变空、图片空白。
 * 此处对「无尖括号、看起来像单独 URL」的 Tauri 资源地址放行。
 */
export function bootstrapDompurifyForTauriAssets(): void {
  if (typeof window === "undefined" || window.__wiseDompurifyTauriAssetPatch) {
    return;
  }
  window.__wiseDompurifyTauriAssetPatch = true;

  const original = DOMPurify.sanitize.bind(DOMPurify) as typeof DOMPurify.sanitize;

  DOMPurify.sanitize = ((
    dirty: string | Node,
    cfg?: Config,
  ): ReturnType<typeof original> => {
    if (typeof dirty === "string") {
      const t = dirty.trim();
      if (
        t.length > 0
        && !/[<>]/.test(t)
        && (t.startsWith("asset:")
          || /^https?:\/\/asset\./i.test(t))
      ) {
        return dirty;
      }
    }
    return original(dirty, cfg);
  }) as typeof DOMPurify.sanitize;
}
