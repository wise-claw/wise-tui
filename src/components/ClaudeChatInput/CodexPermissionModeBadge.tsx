import {
  CheckOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Popover, Spin } from "antd";
import { useCallback, useState, type ReactNode } from "react";
import type { CodexPermissionPreset } from "../DefaultConfigPanel/codexDefaultSettings";
import { useCodexDefaultSettingsSetting } from "../DefaultConfigPanel/useCodexDefaultSettingsSetting";
import "./CodexPermissionModeBadge.css";

const PRESET_OPTIONS: Array<{
  value: CodexPermissionPreset;
  label: string;
  hint: string;
  icon: ReactNode;
  tone?: "danger";
}> = [
  {
    value: "ask",
    label: "请求批准",
    hint: "外部文件与联网时始终询问",
    icon: <StopOutlined />,
  },
  {
    value: "auto",
    label: "替我审批",
    hint: "仅风险操作时请求批准",
    icon: <SafetyCertificateOutlined />,
  },
  {
    value: "full",
    label: "完全访问",
    hint: "可不受限制访问互联网与本机文件",
    icon: <ExclamationCircleOutlined />,
    tone: "danger",
  },
  {
    value: "custom",
    label: "自定义",
    hint: "使用 config.toml 中定义的权限",
    icon: <SettingOutlined />,
  },
];

const PILL_LABEL: Record<CodexPermissionPreset, string> = {
  ask: "请求批准",
  auto: "替我审批",
  full: "完全访问",
  custom: "自定义",
};

/**
 * Codex / Codex RPC Composer 底栏权限预设选择器（对齐 ChatGPT Codex 输入栏四档）。
 * 写入与「工作台配置 → Codex 沙箱/审批」同源的 `wise.codexDefaultSettings.v1`；
 * 对新会话 / 新 thread 生效。
 */
export function CodexPermissionModeBadge({ iconOnly = false }: { iconOnly?: boolean }) {
  const settings = useCodexDefaultSettingsSetting();
  const [open, setOpen] = useState(false);
  const preset = settings.permissionPreset;

  const handleSelect = useCallback(
    async (next: CodexPermissionPreset) => {
      if (next === preset) {
        setOpen(false);
        return;
      }
      try {
        await settings.savePermissionPreset(next);
        setOpen(false);
      } catch {
        // savePermissionPreset 已 toast
      }
    },
    [preset, settings],
  );

  if (settings.loading && !preset) {
    return <Spin size="small" style={{ marginLeft: 2 }} />;
  }

  const activeTone = preset === "full" ? "danger" : "default";

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      overlayClassName="app-codex-permission-mode-popover"
      content={
        <div className="app-codex-permission-mode-menu" role="menu" aria-label="Codex 权限预设">
          <div className="app-codex-permission-mode-menu__header">应如何批准操作？</div>
          {PRESET_OPTIONS.map((opt) => {
            const selected = opt.value === preset;
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
        data-codex-permission-preset={preset}
        aria-label={`Codex 权限：${PILL_LABEL[preset]}`}
        title={PILL_LABEL[preset]}
        disabled={settings.saving}
      >
        {preset === "full" ? <ExclamationCircleOutlined /> : <SafetyCertificateOutlined />}
        {iconOnly ? null : (
          <span className="app-codex-permission-mode-pill__label">{PILL_LABEL[preset]}</span>
        )}
      </button>
    </Popover>
  );
}
