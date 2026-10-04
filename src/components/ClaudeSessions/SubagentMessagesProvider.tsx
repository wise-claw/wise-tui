import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import type { ClaudeSession, ToolUsePart } from "../../types";
import { SubagentMessageContext } from "./subagentMessageContext";
import "./SubagentMessagesDrawer.css";

const SubagentMessagesDrawer = lazy(() => import("./SubagentMessagesDrawer"));

/** 抽屉放在虚拟消息行之外，上翻消息时不会随卡片卸载。 */
export function SubagentMessagesProvider({ session, children }: {
  session: ClaudeSession;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<{ sessionId: string; part: ToolUsePart } | null>(null);
  const open = useCallback((part: ToolUsePart) => {
    setTarget({ sessionId: session.id, part });
  }, [session.id]);
  const close = useCallback(() => setTarget(null), []);
  useEffect(() => setTarget(null), [session.id]);
  const selected = target?.sessionId === session.id ? target.part : null;
  // 优先使用流式更新后的工具快照，保持运行状态与结果同步。
  const part = selected ? session.messages.flatMap((msg) => msg.parts ?? [])
    .find((entry): entry is ToolUsePart => entry.type === "tool_use" && entry.id === selected.id) ?? selected : null;

  return (
    <SubagentMessageContext.Provider value={open}>
      {children}
      {part ? (
        <Suspense fallback={null}>
          <SubagentMessagesDrawer key={`${session.id}:${part.id}`} parentSession={session} part={part} onClose={close} />
        </Suspense>
      ) : null}
    </SubagentMessageContext.Provider>
  );
}
