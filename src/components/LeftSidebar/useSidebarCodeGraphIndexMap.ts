import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCodeGraphIndexStatus } from "../../services/codeKnowledgeGraph";
import type { CodeGraphIndexStatusResponse } from "../../types/codeKnowledgeGraph";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";

export type SidebarCodeGraphIndexStatus = CodeGraphIndexStatusResponse["status"];

/** 侧栏仓库行：跟踪各仓代码图谱索引状态，索引完成后展示「查看图谱」入口。 */
export function useSidebarCodeGraphIndexMap(repositoryIds: number[]) {
  const [byId, setById] = useState<Record<number, SidebarCodeGraphIndexStatus>>({});

  const ids = useMemo(
    () => [...new Set(repositoryIds.filter((id) => Number.isFinite(id)))].sort((a, b) => a - b),
    [repositoryIds],
  );
  const idsKey = ids.join(",");

  const refresh = useCallback(async () => {
    if (ids.length === 0) return;
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const status = await getCodeGraphIndexStatus(id);
          return [id, status.status] as const;
        } catch {
          return [id, "idle" as const];
        }
      }),
    );
    setById((prev) => {
      const next = { ...prev };
      for (const [id, status] of entries) next[id] = status;
      return next;
    });
  }, [ids]);

  useEffect(() => {
    void refresh();
  }, [refresh, idsKey]);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      const attach = async (eventName: string, handler: (payload: unknown) => void) => {
        const unlisten = await listen(eventName, (event) => handler(event.payload));
        if (cancelled) {
          safeUnlisten(unlisten);
          return;
        }
        cleanups.push(() => safeUnlisten(unlisten));
      };

      await attach("code-graph-index-complete", (payload) => {
        const id = (payload as { repositoryId?: unknown } | undefined)?.repositoryId;
        if (typeof id === "number" && Number.isFinite(id)) {
          setById((prev) => ({ ...prev, [id]: "done" }));
          return;
        }
        void refresh();
      });

      await attach("code-graph-index-error", (payload) => {
        const id = (payload as { repositoryId?: unknown } | undefined)?.repositoryId;
        if (typeof id === "number" && Number.isFinite(id)) {
          setById((prev) => ({ ...prev, [id]: "error" }));
        }
      });

      await attach("code-graph-project-search-complete", () => {
        void refresh();
      });

      await attach("code-graph-association-build-complete", () => {
        void refresh();
      });
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [refresh]);

  return byId;
}
