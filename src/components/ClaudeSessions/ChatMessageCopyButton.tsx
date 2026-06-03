import { memo, useCallback, useRef } from "react";
import { message } from "antd";

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z" />
    </svg>
  );
}

interface Props {
  text: string;
}

function ChatMessageCopyButtonInner({ text }: Props) {
  const resetTimerRef = useRef<number | null>(null);

  const handleCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed) return;
      void navigator.clipboard.writeText(trimmed).then(
        () => {
          message.success("已复制到剪贴板");
          const button = event.currentTarget;
          button.setAttribute("data-copied", "true");
          if (resetTimerRef.current != null) {
            window.clearTimeout(resetTimerRef.current);
          }
          resetTimerRef.current = window.setTimeout(() => {
            button.removeAttribute("data-copied");
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
    <button
      type="button"
      className="app-claude-message-copy-btn"
      aria-label="复制消息"
      title="复制"
      onClick={handleCopy}
    >
      <CopyIcon />
    </button>
  );
}

export const ChatMessageCopyButton = memo(ChatMessageCopyButtonInner);
