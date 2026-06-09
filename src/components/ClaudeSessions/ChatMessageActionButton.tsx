import { memo, type ReactNode } from "react";
import { HoverHint } from "../shared/HoverHint";
import { Button } from "antd";

interface Props {
  icon: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

function ChatMessageActionButtonInner({ icon, ariaLabel, title, onClick, className }: Props) {
  return (
    <HoverHint title={title}>
      <Button
        type="text"
        size="small"
        className={["app-claude-message-action", className].filter(Boolean).join(" ")}
        icon={icon}
        aria-label={ariaLabel}
        onClick={onClick}
      />
    </HoverHint>
  );
}

export const ChatMessageActionButton = memo(ChatMessageActionButtonInner);
