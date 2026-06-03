import { EditOutlined } from "@ant-design/icons";
import { memo, useCallback } from "react";
import { applyStarterPromptToComposer } from "../../constants/workflowUiEvents";
import { ChatMessageActionButton } from "./ChatMessageActionButton";

interface Props {
  sessionId: string;
  text: string;
}

function ChatMessageInsertComposerButtonInner({ sessionId, text }: Props) {
  const handleInsert = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed) return;
      applyStarterPromptToComposer({ sessionId, prompt: text });
    },
    [sessionId, text],
  );

  if (!text.trim()) return null;

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
