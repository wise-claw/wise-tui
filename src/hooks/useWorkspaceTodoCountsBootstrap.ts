import { useEffect } from "react";
import { syncWorkspaceTodoCountsScope } from "../stores/workspaceTodoCountsStore";

/** 初始化全局待办角标 store；不向 LeftSidebar 注入会随角标变化的 state。 */
export function useWorkspaceTodoCountsBootstrap(enabled = true): void {
  useEffect(() => {
    return syncWorkspaceTodoCountsScope(enabled);
  }, [enabled]);
}
