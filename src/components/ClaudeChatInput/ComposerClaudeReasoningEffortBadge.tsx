import { CheckOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import { useCallback, useState, type ReactNode } from "react";
import {
  CLAUDE_REASONING_EFFORTS,
  CLAUDE_REASONING_EFFORT_HINTS,
  CLAUDE_REASONING_EFFORT_LABELS,
  type ClaudeReasoningEffort,
  claudeReasoningEffortLabel,
  normalizeClaudeReasoningEffort,
} from "../../constants/claudeReasoningEffort";
import "./CodexPermissionModeBadge.css";

const OPTIONS: Array<{
  value: ClaudeReasoningEffort;
  label: string;
  hint: string;
}> = CLAUDE_REASONING_EFFORTS.map((value) => ({
  value,
  label: CLAUDE_REASONING_EFFORT_LABELS[value],
  hint: CLAUDE_REASONING_EFFORT_HINTS[value],
}));

/**
 * Claude Code Composer 底栏「推理强度」选择器（对齐 Claude Code `--effort` 五档）。
 * 写入会话（tabs.json）；经 spawn `cliExtras.effort` 下发。
 * OMC UltracodeChip 开启时仍强制 max（与选项 `ultracode` 无关）。
 */
export function ComposerClaudeReasoningEffortBadge({
  effort: effortProp,
  onEffortChange,
  disabled = false,
  iconOnly = false,
}: {
  /** 会话落盘值；缺省时回退默认 high。 */
  effort?: string | null;
  onEffortChange?: (effort: string) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const effort = normalizeClaudeReasoningEffort(effortProp);
  const label = claudeReasoningEffortLabel(effort);

  const handleSelect = useCallback(
    (next: ClaudeReasoningEffort) => {
      onEffortChange?.(next);
      setOpen(false);
    },
    [onEffortChange],
  );

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      overlayClassName="app-codex-permission-mode-popover"
      content={
        <div className="app-codex-permission-mode-menu" role="menu" aria-label="推理强度">
          <div className="app-codex-permission-mode-menu__header">推理强度</div>
          {OPTIONS.map((opt) => {
            const selected = opt.value === effort;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`app-codex-permission-mode-menu__item${selected ? " is-selected" : ""}`}
                disabled={disabled}
                onClick={() => handleSelect(opt.value)}
              >
                <span className="app-codex-permission-mode-menu__icon">
                  <ThunderboltOutlined />
                </span>
                <span className="app-codex-permission-mode-menu__text">
                  <span className="app-codex-permission-mode-menu__label">
                    {opt.label} · {opt.value}
                  </span>
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
        className={`app-codex-permission-mode-pill${
          iconOnly ? " app-codex-permission-mode-pill--icon-only" : ""
        }`}
        data-claude-reasoning-effort={effort}
        aria-label={`推理强度：${label}`}
        title={`推理强度：${label}`}
        disabled={disabled}
      >
        <ThunderboltOutlined />
        {iconOnly ? null : (
          <span className="app-codex-permission-mode-pill__label">{label}</span>
        )}
      </button>
    </Popover>
  );
}
