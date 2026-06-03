import { memo, useMemo } from "react";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import { resolveChatMessageComposerInsertText } from "../../utils/claudeChatMessageDisplay";
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
  const insertText = useMemo(
    () => (sessionId ? resolveChatMessageComposerInsertText(msg, sessionsForDispatchLookup) : ""),
    [sessionId, msg, sessionsForDispatchLookup],
  );
  const showInsert = Boolean(insertText.trim());

  const actions = (
    <>
      {showInsert ? <ChatMessageInsertComposerButton sessionId={sessionId!} text={insertText} /> : null}
      <ChatMessageCopyButton text={copyText} />
    </>
  );

  if (floating) {
    return <span className="app-claude-message-floating-actions">{actions}</span>;
  }

  return <span className="app-claude-message-header-actions">{actions}</span>;
}

export const ChatMessageRowActions = memo(ChatMessageRowActionsInner);
