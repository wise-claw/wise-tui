/** Props memo：跳过指定 key 与函数 props，避免 App 壳层每帧新建回调导致子树重渲染。 */
export function arePropsEqualSkipping<T extends object>(
  prev: T,
  next: T,
  options?: {
    skipKeys?: readonly (keyof T)[];
    skipFunctions?: boolean;
  },
): boolean {
  if (prev === next) return true;
  const skipKeySet = new Set(options?.skipKeys ?? []);
  const skipFunctions = options?.skipFunctions ?? false;
  for (const key of Object.keys(prev) as (keyof T)[]) {
    if (skipKeySet.has(key)) continue;
    const prevValue = prev[key];
    const nextValue = next[key];
    if (skipFunctions && (typeof prevValue === "function" || typeof nextValue === "function")) {
      continue;
    }
    if (!Object.is(prevValue, nextValue)) return false;
  }
  return true;
}
