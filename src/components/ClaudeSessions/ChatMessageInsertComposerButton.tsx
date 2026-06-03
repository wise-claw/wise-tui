import { EditOutlined } from "@ant-design/icons";
import { memo, useCallback } from "react";
import { applyStarterPromptToComposer } from "../../constants/workflowUiEvents";
import type { ChatMessageComposerInsertPayload } from "../../utils/claudeChatMessageDisplay";
import { ChatMessageActionButton } from "./ChatMessageActionButton";

interface Props {
  sessionId: string;
  insert: ChatMessageComposerInsertPayload;
}

function ChatMessageInsertComposerButtonInner({ sessionId, insert }: Props) {
  const handleInsert = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      applyStarterPromptToComposer({
        sessionId,
        prompt: insert.fullText,
        composerMain: insert.composerMain,
        attachmentPaths: insert.attachmentPaths,
      });
    },
    [sessionId, insert],
  );

  if (!insert.composerMain.trim() && insert.attachmentPaths.length === 0) return null;

  return (
    <ChatMessageActionButton
      className="app-claude-message-action--insert"
      icon={<EditOutlined />}
      ariaLabel="填入会话输入框并聚焦"
      title="填入输入框"
      onClick={handleInsert}
    />
  );
}

export const ChatMessageInsertComposerButton = memo(ChatMessageInsertComposerButtonInner);
