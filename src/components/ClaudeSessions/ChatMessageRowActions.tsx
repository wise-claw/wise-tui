import { PlayCircleOutlined } from "@ant-design/icons";
import { memo, useCallback, useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import {
  resolveChatMessageComposerInsertPayload,
  type SessionDispatchLookup,
} from "../../utils/claudeChatMessageDisplay";
import { ChatMessageCopyButton } from "./ChatMessageCopyButton";
import { ChatMessageInsertComposerButton } from "./ChatMessageInsertComposerButton";
import { ChatMessageActionButton } from "./ChatMessageActionButton";

interface Props {
  sessionId?: string;
  msg: ClaudeMessage;
  copyText: string;
  toolUser: boolean;
  sessionsForDispatchLookup?: SessionDispatchLookup;
  onReplayUserMessage?: (prompt: string) => void;
  /** 无 sender 行时按钮浮在气泡右上角 */
  floating?: boolean;
}

function ChatMessageRowActionsInner({
  sessionId,
  msg,
  copyText,
  toolUser: _toolUser,
  sessionsForDispatchLookup,
  onReplayUserMessage,
  floating = false,
}: Props) {
  const insertPayload = useMemo(
    () => (sessionId ? resolveChatMessageComposerInsertPayload(msg, sessionsForDispatchLookup) : null),
    [sessionId, msg, sessionsForDispatchLookup],
  );
  const showInsert = Boolean(insertPayload);
  const showReplay = msg.role === "user" && !_toolUser && Boolean(insertPayload) && Boolean(onReplayUserMessage);
  const showCopy = msg.role !== "assistant" && !_toolUser && Boolean(copyText.trim());
  const handleReplay = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (insertPayload && onReplayUserMessage) onReplayUserMessage(insertPayload.fullText);
    },
    [insertPayload, onReplayUserMessage],
  );

  if (!showInsert && !showReplay && !showCopy) return null;

  const actions = (
    <>
      {showInsert ? (
        <ChatMessageInsertComposerButton sessionId={sessionId!} insert={insertPayload!} />
      ) : null}
      {showReplay ? (
        <ChatMessageActionButton
          className="app-claude-message-action--replay"
          icon={<PlayCircleOutlined />}
          ariaLabel="再次执行"
          title="再次执行"
          onClick={handleReplay}
        />
      ) : null}
      {showCopy ? <ChatMessageCopyButton text={copyText} /> : null}
    </>
  );

  if (floating) {
    return <span className="app-claude-message-floating-actions">{actions}</span>;
  }

  return <span className="app-claude-message-header-actions">{actions}</span>;
}

export const ChatMessageRowActions = memo(ChatMessageRowActionsInner);
