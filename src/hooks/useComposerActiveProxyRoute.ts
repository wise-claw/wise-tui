import { useMemo, useSyncExternalStore } from "react";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import {
  getComposerProxyRouteStoreSnapshot,
  subscribeComposerProxyRouteStore,
} from "../stores/composerProxyRouteStore";
import {
  resolveComposerActiveProxyRoute,
  type ComposerActiveProxyRoute,
} from "../utils/composerActiveProxyRoute";

/** Composer 底栏：当前会话执行引擎实际经行的 Wise 内置代理（无代理时 null）。 */
export function useComposerActiveProxyRoute(
  engine: SessionExecutionEngine,
  options?: { modelLabel?: string | null },
): ComposerActiveProxyRoute | null {
  const snapshot = useSyncExternalStore(
    subscribeComposerProxyRouteStore,
    getComposerProxyRouteStoreSnapshot,
    getComposerProxyRouteStoreSnapshot,
  );

  return useMemo(
    () =>
      resolveComposerActiveProxyRoute(
        engine,
        snapshot.opencodeGo,
        snapshot.llmProxy,
        snapshot.fcc,
        options,
      ),
    [engine, snapshot, options?.modelLabel],
  );
}

/** 仅返回代理名称（兼容旧调用）。 */
export function useComposerActiveProxyLabel(
  engine: SessionExecutionEngine,
  options?: { modelLabel?: string | null },
): string | null {
  return useComposerActiveProxyRoute(engine, options)?.label ?? null;
}
