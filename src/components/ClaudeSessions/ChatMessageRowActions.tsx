import { memo, useMemo } from "react";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import { resolveChatMessageComposerInsertPayload } from "../../utils/claudeChatMessageDisplay";
import { ChatMessageCopyButton } from "./ChatMessageCopyButton";
import { ChatMessageInsertComposerButton } from "./ChatMessageInsertComposerButton";

interface Props {
  sessionId?: string;
  msg: ClaudeMessage;
  copyText: string;
  toolUser: boolean;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  /** 无 sender 行时按钮浮在气泡右上角 */
  floating?: boolean;
}

function ChatMessageRowActionsInner({
  sessionId,
  msg,
  copyText,
  toolUser: _toolUser,
  sessionsForDispatchLookup,
  floating = false,
}: Props) {
  const insertPayload = useMemo(
    () => (sessionId ? resolveChatMessageComposerInsertPayload(msg, sessionsForDispatchLookup) : null),
    [sessionId, msg, sessionsForDispatchLookup],
  );
  const showInsert = Boolean(insertPayload);

  const actions = (
    <>
      {showInsert ? (
        <ChatMessageInsertComposerButton sessionId={sessionId!} insert={insertPayload!} />
      ) : null}
      <ChatMessageCopyButton text={copyText} />
    </>
  );

  if (floating) {
    return <span className="app-claude-message-floating-actions">{actions}</span>;
  }

  return <span className="app-claude-message-header-actions">{actions}</span>;
}

export const ChatMessageRowActions = memo(ChatMessageRowActionsInner);
