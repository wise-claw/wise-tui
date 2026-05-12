import { FolderOpenOutlined, LeftOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Modal } from "antd";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShortcutsPopoverBody } from "../AppShortcutsPopoverBody";
import { ClaudeConfigDirPanel } from "../ClaudeConfigDirPanel";
import { ClaudeSandboxHelpPopoverBody } from "../ClaudeSandboxHelpPopoverBody";
import { DingTalkEnterpriseBotPopoverBody } from "../DingTalkEnterpriseBotPopoverBody";
import { IconClaudeSandboxHelp } from "../icons/IconClaudeSandboxHelp";
import { IconKeyboardShortcuts } from "../icons/IconKeyboardShortcuts";
import "./index.css";

export type AppSettingsModalTab = "claudeConfigDir" | "dingtalk" | "shortcuts" | "sandbox";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 每次 `open` 变为 `true` 时若传入，则选中对应 Tab */
  initialTab?: AppSettingsModalTab;
}

const TABS: { key: AppSettingsModalTab; label: string; icon: ReactNode }[] = [
  { key: "claudeConfigDir", label: "Claude Code 配置目录", icon: <FolderOpenOutlined /> },
  { key: "dingtalk", label: "钉钉企业内部应用机器人", icon: <RobotOutlined /> },
  { key: "shortcuts", label: "快捷键说明", icon: <IconKeyboardShortcuts /> },
  { key: "sandbox", label: "Claude 沙箱 / git·rm 权限", icon: <IconClaudeSandboxHelp /> },
];

export function AppSettingsModal({ open, onClose, initialTab = "dingtalk" }: Props) {
  const [tab, setTab] = useState<AppSettingsModalTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      closable={false}
      maskClosable
      keyboard
      centered={false}
      width="100%"
      rootClassName="app-settings-modal-root"
      className="app-settings-modal"
      styles={{
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <div className="app-settings-modal__shell">
        <div className="app-settings-modal__topbar">
          <Button type="text" className="app-settings-modal__back" icon={<LeftOutlined />} onClick={handleClose}>
            返回应用
          </Button>
        </div>
        <div className="app-settings-modal__split">
          <nav className="app-settings-modal__nav" aria-label="设置分类">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`app-settings-modal__nav-item${tab === item.key ? " app-settings-modal__nav-item--active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                <span className="app-settings-modal__nav-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="app-settings-modal__nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <main className="app-settings-modal__main">
            <TypographyTitle tab={tab} />
            <div className="app-settings-modal__scroll">
              <div className="app-settings-modal__pane" hidden={tab !== "claudeConfigDir"}>
                <ClaudeConfigDirPanel />
              </div>
              <div className="app-settings-modal__pane" hidden={tab !== "dingtalk"}>
                <DingTalkEnterpriseBotPopoverBody />
              </div>
              <div className="app-settings-modal__pane" hidden={tab !== "shortcuts"}>
                <AppShortcutsPopoverBody density="default" />
              </div>
              <div className="app-settings-modal__pane app-settings-modal__pane--sandbox" hidden={tab !== "sandbox"}>
                <ClaudeSandboxHelpPopoverBody />
              </div>
            </div>
          </main>
        </div>
      </div>
    </Modal>
  );
}

function TypographyTitle({ tab }: { tab: AppSettingsModalTab }) {
  const meta = TABS.find((t) => t.key === tab);
  const title = meta?.label ?? "设置";
  return <h1 className="app-settings-modal__title">{title}</h1>;
}
