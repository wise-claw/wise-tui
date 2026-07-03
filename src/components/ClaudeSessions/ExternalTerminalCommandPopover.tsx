import { Input, message } from "antd";
import { useEffect, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import "./index.css";

export type ExternalTerminalCommandPopoverProps = {
  /** 当前工作区路径，用于占位提示 */
  workspacePath: string;
  /** 持久化存储中已有的指令（可能为空） */
  initialCommand: string;
  /** 保存指令到 localStorage */
  onSave: (command: string) => void;
  /** 清空指令 */
  onClear: () => void;
  /** 关闭 popover */
  onClose: () => void;
  /** 自动检测到的运行指令（用于占位提示），可为 null */
  detectedCommand?: string | null;
};

/**
 * 精简版 popover：仅一个"运行指令"输入框 + 保存/清空/关闭按钮。
 *
 * 外部终端按钮的运行指令独立存储（`wise.topbar.terminal-run-command:<cwd>`），
 * 与「运行」按钮的 `wise.topbar.run-command:<cwd>` 分开配置，互不影响。
 */
export function ExternalTerminalCommandPopover({
  workspacePath,
  initialCommand,
  onSave,
  onClear,
  onClose,
  detectedCommand = null,
}: ExternalTerminalCommandPopoverProps) {
  const [draft, setDraft] = useState(initialCommand);

  // 每次打开 popover 时同步一次初值（避免父组件 hook 异步水合时旧值残留）
  useEffect(() => {
    setDraft(initialCommand);
  }, [initialCommand]);

  const trimmed = draft.trim();
  const placeholder = detectedCommand?.trim() || "bun run tauri:dev";

  const handleSave = () => {
    if (!trimmed) {
      message.warning("请输入运行指令");
      return;
    }
    onSave(trimmed);
    message.success("已保存运行指令");
  };

  const handleClear = () => {
    setDraft("");
    onClear();
    message.success("已清空运行指令");
  };

  return (
    <div className="app-run-command-popover__content">
      <header className="app-run-command-popover__header">
        <span className="app-run-command-popover__title">外部终端运行指令</span>
      </header>

      <section className="app-run-command-popover__section app-run-command-popover__section--form">
        <label className="app-run-command-popover__row">
          <span className="app-run-command-popover__field-label">运行命令</span>
          <Input
            size="small"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            onPressEnter={handleSave}
            suffix={
              <HoverHint title="保存指令">
                <button
                  type="button"
                  className="app-run-command-popover__suffix-btn"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleSave();
                  }}
                  disabled={!trimmed}
                >
                  <SaveIcon />
                </button>
              </HoverHint>
            }
          />
        </label>
        <div className="app-run-command-popover__detect-meta">
          工作目录：{workspacePath || "未选择仓库"}
        </div>
        <div className="app-run-command-popover__detect-meta">
          左键单击外部终端按钮即可打开终端并执行该命令。留空时仅打开终端。
        </div>
      </section>

      <footer className="app-run-command-popover__footer">
        <button
          type="button"
          className="app-run-command-popover__btn app-run-command-popover__btn--ghost"
          onClick={onClose}
        >
          关闭
        </button>
        <div className="app-run-command-popover__footer-actions">
          {initialCommand.trim() ? (
            <button
              type="button"
              className="app-run-command-popover__btn app-run-command-popover__btn--ghost"
              onClick={handleClear}
            >
              清空
            </button>
          ) : null}
          <button
            type="button"
            className="app-run-command-popover__btn app-run-command-popover__btn--primary app-run-command-popover__btn--footer-main"
            onClick={handleSave}
            disabled={!trimmed}
          >
            保存
          </button>
        </div>
      </footer>
    </div>
  );
}

function SaveIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}