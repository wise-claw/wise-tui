import { CheckOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import { useCallback, useState, type ReactNode } from "react";
import {
  CODEX_REASONING_EFFORTS,
  CODEX_REASONING_EFFORT_HINTS,
  CODEX_REASONING_EFFORT_LABELS,
  type CodexReasoningEffort,
  codexReasoningEffortLabel,
  normalizeCodexReasoningEffort,
} from "../../constants/codexReasoningEffort";
import {
  getCodexRpcReasoningEffort,
  setCodexRpcReasoningEffort,
} from "../../stores/codexRpcReasoningEffortStore";
import "./CodexPermissionModeBadge.css";

const OPTIONS: Array<{
  value: CodexReasoningEffort;
  label: string;
  hint: string;
}> = CODEX_REASONING_EFFORTS.map((value) => ({
  value,
  label: CODEX_REASONING_EFFORT_LABELS[value],
  hint: CODEX_REASONING_EFFORT_HINTS[value],
}));

/**
 * Codex RPC Composer 底栏「推理强度」选择器（对齐 ChatGPT 推理强度六档）。
 * 写入会话（tabs.json）+ 内存镜像；经 `turn/start.effort` 下发。
 */
export function ComposerCodexReasoningEffortBadge({
  sessionId,
  effort: effortProp,
  onEffortChange,
  disabled = false,
  iconOnly = false,
}: {
  sessionId: string;
  /** 会话落盘值；缺省时回退内存 store。 */
  effort?: string | null;
  onEffortChange?: (effort: string) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const effort = normalizeCodexReasoningEffort(
    effortProp ?? getCodexRpcReasoningEffort(sessionId),
  );
  const label = codexReasoningEffortLabel(effort);

  const handleSelect = useCallback(
    (next: CodexReasoningEffort) => {
      setCodexRpcReasoningEffort(sessionId, next);
      onEffortChange?.(next);
      setOpen(false);
    },
    [sessionId, onEffortChange],
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
        className={`app-codex-permission-mode-pill${
          iconOnly ? " app-codex-permission-mode-pill--icon-only" : ""
        }`}
        data-codex-reasoning-effort={effort}
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
