import { Typography } from "antd";
import { Suspense, lazy } from "react";
import "./index.css";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

interface Props {
  /** 用于 Milkdown 实例稳定重挂载（如 scope + slot + 字段名） */
  instanceKey: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (markdown: string) => void;
}

/**
 * 提示词分层正文编辑：复用全局 `MilkdownEditor`（Crepe / Markdown），与任务拆分等面板一致。
 */
export function PromptMilkdownField({ instanceKey, label, hint, value, onChange }: Props) {
  return (
    <div className="app-prompt-milkdown-field">
      <div className="app-prompt-milkdown-field__label-row">
        <Typography.Text strong>{label}</Typography.Text>
        {hint ? (
          <Typography.Text type="secondary" className="app-prompt-milkdown-field__hint">
            {hint}
          </Typography.Text>
        ) : null}
      </div>
      <div className="app-prompt-milkdown-field__editor">
        <Suspense fallback={null}>
          <MilkdownEditor key={instanceKey} text={value} onChange={onChange} />
        </Suspense>
      </div>
    </div>
  );
}
