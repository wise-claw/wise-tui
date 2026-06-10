import { memo, useCallback } from "react";
import { CopyFeedbackIcon } from "../shared/CopyFeedbackIcon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { ChatMessageActionButton } from "./ChatMessageActionButton";

interface Props {
  text: string;
}

function ChatMessageCopyButtonInner({ text }: Props) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void copy(text);
    },
    [copy, text],
  );

  if (!text.trim()) return null;

  return (
    <ChatMessageActionButton
      className={copied ? "app-claude-message-action--copied" : undefined}
      icon={<CopyFeedbackIcon copied={copied} />}
      ariaLabel="复制消息"
      title={copied ? "已复制" : "复制"}
      onClick={handleCopy}
    />
  );
}

export const ChatMessageCopyButton = memo(ChatMessageCopyButtonInner);
