import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";

/** ClaudeSessions 壳层 memo：忽略 `sessions` 与回调引用，结构/布局字段变化才重渲染。 */
export function claudeSessionsShellPropsEqual<T extends { sessions: unknown }>(
  prev: T,
  next: T,
): boolean {
  return arePropsEqualSkipping(prev, next, {
    skipKeys: ["sessions"],
    skipFunctions: true,
  });
}
