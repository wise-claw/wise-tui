import { Typography } from "antd";
import { Suspense, lazy } from "react";
import "./index.css";

const TiptapEditor = lazy(() =>
  import("../TiptapEditor").then((module) => ({ default: module.TiptapEditor })),
);

interface Props {
  /** 用于编辑器实例稳定重挂载（如 scope + slot + 字段名） */
  instanceKey: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (markdown: string) => void;
}

/**
 * 提示词分层正文编辑：复用全局 `TiptapEditor`（语雀风格 / Markdown），与任务拆分等面板一致。
 */
export function PromptRichTextField({ instanceKey, label, hint, value, onChange }: Props) {
  return (
    <div className="app-prompt-rich-text-field">
      <div className="app-prompt-rich-text-field__label-row">
        <Typography.Text strong>{label}</Typography.Text>
        {hint ? (
          <Typography.Text type="secondary" className="app-prompt-rich-text-field__hint">
            {hint}
          </Typography.Text>
        ) : null}
      </div>
      <div className="app-prompt-rich-text-field__editor">
        <Suspense fallback={null}>
          <TiptapEditor key={instanceKey} text={value} onChange={onChange} compact />
        </Suspense>
      </div>
    </div>
  );
}
