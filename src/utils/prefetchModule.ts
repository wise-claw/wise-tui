/** Fire-and-forget chunk prefetch; failures during HMR must not become unhandled rejections. */
export function prefetchModule(
  loader: () => Promise<unknown>,
  label?: string,
): void {
  void loader().catch((error) => {
    if (!import.meta.env.DEV) return;
    const detail = error instanceof Error ? error.message : String(error);
    console.debug(`[prefetch] skipped${label ? `: ${label}` : ""}`, detail);
  });
}
