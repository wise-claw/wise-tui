/** Git 拉取/推送等短操作的最短 loading 展示时长，避免一闪而过。 */
export const GIT_SYNC_MIN_LOADING_MS = 500;

export async function withMinLoadingDuration<T>(
  task: () => Promise<T>,
  minMs: number = GIT_SYNC_MIN_LOADING_MS,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    const remaining = minMs - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remaining);
      });
    }
  }
}
