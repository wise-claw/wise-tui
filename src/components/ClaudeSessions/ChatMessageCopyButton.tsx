import { CopyOutlined } from "@ant-design/icons";
import { memo, useCallback, useRef, useState } from "react";
import { message } from "antd";
import { ChatMessageActionButton } from "./ChatMessageActionButton";

interface Props {
  text: string;
}

function ChatMessageCopyButtonInner({ text }: Props) {
  const resetTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed) return;
      void navigator.clipboard.writeText(trimmed).then(
        () => {
          message.success("已复制到剪贴板");
          setCopied(true);
          if (resetTimerRef.current != null) {
            window.clearTimeout(resetTimerRef.current);
          }
          resetTimerRef.current = window.setTimeout(() => {
            setCopied(false);
            resetTimerRef.current = null;
          }, 1500);
        },
        () => message.error("复制失败"),
      );
    },
    [text],
  );

  if (!text.trim()) return null;

  return (
    <ChatMessageActionButton
      className={copied ? "app-claude-message-action--copied" : undefined}
      icon={<CopyOutlined />}
      ariaLabel="复制消息"
      title={copied ? "已复制" : "复制"}
      onClick={handleCopy}
    />
  );
}

export const ChatMessageCopyButton = memo(ChatMessageCopyButtonInner);
