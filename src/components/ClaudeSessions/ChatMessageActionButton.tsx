import { memo, type ReactNode } from "react";
import { Button, Tooltip } from "antd";

interface Props {
  icon: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

function ChatMessageActionButtonInner({ icon, ariaLabel, title, onClick, className }: Props) {
  return (
    <Tooltip title={title} mouseEnterDelay={0.35}>
      <Button
        type="text"
        size="small"
        className={["app-claude-message-action", className].filter(Boolean).join(" ")}
        icon={icon}
        aria-label={ariaLabel}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export const ChatMessageActionButton = memo(ChatMessageActionButtonInner);
