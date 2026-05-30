import { pathIsAccessibleDirectory } from "../services/repository";

const resolved = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

export async function pathIsAccessibleDirectoryCached(path: string): Promise<boolean> {
  const key = path.trim();
  if (!key) return false;
  const hit = resolved.get(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = pathIsAccessibleDirectory(key)
    .then((ok) => {
      resolved.set(key, ok);
      inflight.delete(key);
      return ok;
    })
    .catch(() => {
      resolved.set(key, false);
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
