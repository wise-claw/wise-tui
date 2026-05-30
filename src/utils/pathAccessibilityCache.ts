import { pathIsAccessibleDirectory } from "../services/repository";

const resolved = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();
const MAX_RESOLVED_PATH_ACCESSIBILITY_CACHE = 200;

function rememberResolved(key: string, ok: boolean): void {
  resolved.delete(key);
  resolved.set(key, ok);
  while (resolved.size > MAX_RESOLVED_PATH_ACCESSIBILITY_CACHE) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
}

/** 同步读取已缓存的路径可访问性；未缓存时返回 undefined。 */
export function readPathAccessibilityCache(path: string): boolean | undefined {
  const key = path.trim();
  if (!key) return false;
  const hit = resolved.get(key);
  if (hit === undefined) return undefined;
  rememberResolved(key, hit);
  return hit;
}

export async function pathIsAccessibleDirectoryCached(path: string): Promise<boolean> {
  const key = path.trim();
  if (!key) return false;
  const hit = readPathAccessibilityCache(key);
  if (hit !== undefined) {
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = pathIsAccessibleDirectory(key)
    .then((ok) => {
      rememberResolved(key, ok);
      inflight.delete(key);
      return ok;
    })
    .catch(() => {
      rememberResolved(key, false);
      inflight.delete(key);
      return false;
    });
  inflight.set(key, promise);
  return promise;
}

export function invalidatePathAccessibilityCache(path?: string): void {
  if (path?.trim()) {
    resolved.delete(path.trim());
    inflight.delete(path.trim());
    return;
  }
  resolved.clear();
  inflight.clear();
}
