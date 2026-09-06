import { useEffect, useState } from "react";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { resolveNewSessionComposerModel } from "../utils/newSessionComposerDefaults";

/** 在子树渲染前隔离会话/执行环境，旧模型不能成为新环境菜单的候选项。 */
export function useComposerModelSelection(
  sessionId: string,
  engine: SessionExecutionEngine,
  sessionModel?: string | null,
) {
  const resolveModel = () => sessionModel?.trim() || resolveNewSessionComposerModel(engine);
  const [model, setModel] = useState(resolveModel);
  const scope = `${sessionId}:${engine}`;
  const [modelScope, setModelScope] = useState(scope);
  if (modelScope !== scope) {
    setModelScope(scope);
    setModel(resolveModel());
  }
  useEffect(() => {
    setModel(sessionModel?.trim() || resolveNewSessionComposerModel(engine));
  }, [sessionId, sessionModel, engine]);
  return [model, setModel] as const;
}
