import {
  CheckOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Popover, Spin } from "antd";
import { useCallback, useState, type ReactNode } from "react";
import type { ClaudePermissionMode } from "../DefaultConfigPanel/claudeDefaultSettings";
import { useClaudeDefaultSettingsSetting } from "../DefaultConfigPanel/useClaudeDefaultSettingsSetting";
import "./CodexPermissionModeBadge.css";

const PRESET_OPTIONS: Array<{
  value: ClaudePermissionMode;
  label: string;
  hint: string;
  icon: ReactNode;
  tone?: "danger";
}> = [
  {
    value: "default",
    label: "请求批准",
    hint: "工具调用前始终询问",
    icon: <StopOutlined />,
  },
  {
    value: "acceptEdits",
    label: "接受编辑",
    hint: "自动批准文件编辑，其它仍询问",
    icon: <EditOutlined />,
  },
  {
    value: "plan",
    label: "仅计划",
    hint: "规划模式，不直接改仓库",
    icon: <FileSearchOutlined />,
  },
  {
    value: "bypassPermissions",
    label: "完全访问",
    hint: "跳过权限提示（与未设置时后端默认一致）",
    icon: <ExclamationCircleOutlined />,
    tone: "danger",
  },
];

const PILL_LABEL: Record<ClaudePermissionMode, string> = {
  default: "请求批准",
  acceptEdits: "接受编辑",
  plan: "仅计划",
  bypassPermissions: "完全访问",
};

/**
 * Claude Code Composer 底栏权限模式选择器（对齐 Codex 输入栏样式）。
 * 写入与「工作台配置 → Claude 启动 --settings」同源的 `wise.claudeDefaultSettings.v1`；
 * 对新 spawn 生效。
 */
export function ClaudePermissionModeBadge({ iconOnly = false }: { iconOnly?: boolean }) {
  const settings = useClaudeDefaultSettingsSetting();
  const [open, setOpen] = useState(false);
  const mode = settings.effectivePermissionMode;

  const handleSelect = useCallback(
    async (next: ClaudePermissionMode) => {
      if (next === mode && settings.permissionMode != null) {
        setOpen(false);
        return;
      }
      try {
        await settings.savePermissionMode(next);
        setOpen(false);
      } catch {
        // savePermissionMode 已 toast
      }
    },
    [mode, settings],
  );

  if (settings.loading && !settings.value) {
    return <Spin size="small" style={{ marginLeft: 2 }} />;
  }

  const activeTone = mode === "bypassPermissions" ? "danger" : "default";

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      overlayClassName="app-codex-permission-mode-popover"
      content={
        <div className="app-codex-permission-mode-menu" role="menu" aria-label="Claude Code 权限模式">
          <div className="app-codex-permission-mode-menu__header">Claude Code 应如何批准操作？</div>
          {PRESET_OPTIONS.map((opt) => {
            const selected = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`app-codex-permission-mode-menu__item${selected ? " is-selected" : ""}${
                  opt.tone === "danger" ? " is-danger" : ""
                }`}
                disabled={settings.saving}
                onClick={() => void handleSelect(opt.value)}
              >
                <span className="app-codex-permission-mode-menu__icon">{opt.icon}</span>
                <span className="app-codex-permission-mode-menu__text">
                  <span className="app-codex-permission-mode-menu__label">{opt.label}</span>
                  <span className="app-codex-permission-mode-menu__hint">{opt.hint}</span>
                </span>
                {selected ? <CheckOutlined className="app-codex-permission-mode-menu__check" /> : null}
              </button>
            );
          })}
        </div>
      }
    >
      <button
        type="button"
        className={`app-codex-permission-mode-pill app-codex-permission-mode-pill--${activeTone}${
          iconOnly ? " app-codex-permission-mode-pill--icon-only" : ""
        }`}
        data-claude-permission-mode={mode}
        aria-label={`Claude Code 权限：${PILL_LABEL[mode]}`}
        title={PILL_LABEL[mode]}
        disabled={settings.saving}
      >
        {mode === "bypassPermissions" ? (
          <ExclamationCircleOutlined />
        ) : (
          <SafetyCertificateOutlined />
        )}
        {iconOnly ? null : (
          <span className="app-codex-permission-mode-pill__label">{PILL_LABEL[mode]}</span>
        )}
      </button>
    </Popover>
  );
}
