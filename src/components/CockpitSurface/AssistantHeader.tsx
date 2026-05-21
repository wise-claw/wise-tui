import { Button, Tooltip } from "antd";
import { ArrowLeftOutlined, MessageOutlined, SettingOutlined } from "@ant-design/icons";
import type { AssistantEntry } from "../../types/assistant";

export interface AssistantHeaderProps {
  assistant: AssistantEntry | null;
  activeProjectName: string | null;
  /** 显示返回 Hub 按钮(仅在 conversation 子态)。 */
  showBackToHub: boolean;
  /** 为 true 时返回按钮直接关闭 Cockpit（需求拆分全屏）。 */
  backClosesSurface?: boolean;
  onBackToHub: () => void;
  /** 返回主会话;助手不抢占主会话优先级。 */
  onOpenChat: () => void;
  /** 打开助手设置 Drawer。 */
  onOpenSettings?: () => void;
}

/**
 * Cockpit 主屏顶部的助手 Header。两个子态(hub/conversation)共享一个组件,
 * 但根据 `showBackToHub` / `assistant` 决定是否显示助手身份。
 */
export function AssistantHeader({
  assistant,
  activeProjectName,
  showBackToHub,
  backClosesSurface = false,
  onBackToHub,
  onOpenChat,
  onOpenSettings,
}: AssistantHeaderProps) {
  if (!assistant) {
    // hub 子态:不必占满 header,留空即可。
    return null;
  }
  return (
    <header
      className={`cockpit-header${backClosesSurface ? " cockpit-header--overlay-titlebar" : ""}`}
      aria-label="助手 Header"
    >
      {showBackToHub ? (
        <Button
          size="small"
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={onBackToHub}
          aria-label={backClosesSurface ? "关闭需求拆分" : "返回 Hub"}
          title={backClosesSurface ? "关闭" : "返回 Hub"}
        />
      ) : null}
      <span
        className="cockpit-header__avatar"
        style={{ background: assistant.avatarColor ?? "#1677FF" }}
        aria-hidden
      >
        {assistant.name.slice(0, 1)}
      </span>
      <div className="cockpit-header__title">{assistant.name}</div>
      <div className="cockpit-header__divider" aria-hidden />
      <span className="cockpit-header__chip">
        关联工作区:{activeProjectName ?? "未选择"}
      </span>
      <div className="cockpit-header__chip">引擎:{assistant.engineId}</div>
      <div className="cockpit-header__spacer" data-tauri-drag-region />
      <Tooltip title="返回主会话">
        <Button
          size="small"
          type="text"
          icon={<MessageOutlined />}
          onClick={onOpenChat}
          aria-label="返回主会话"
        >
          对话
        </Button>
      </Tooltip>
      <Tooltip title="助手设置">
        <Button
          size="small"
          type="text"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
          aria-label="助手设置"
        />
      </Tooltip>
    </header>
  );
}
