import { HoverHint } from "../shared/HoverHint";
import type { ReactNode } from "react";

export interface DefaultConfigRowProps {
  title: string;
  hint?: string;
  /** 悬停标题时展示的完整说明；未设置时使用 `hint`。 */
  detail?: string;
  control: ReactNode;
  layout?: "inline" | "stack";
  "aria-label"?: string;
}

/** 默认配置：标题 + 可选说明 + 控件。 */
export function DefaultConfigRow({
  title,
  hint,
  detail,
  control,
  layout = "inline",
  "aria-label": ariaLabel,
}: DefaultConfigRowProps) {
  const tooltip = detail ?? hint;
  const titleNode = tooltip ? (
    <HoverHint title={tooltip}>
      <span className="app-default-config-row__title app-default-config-row__title--hinted">{title}</span>
    </HoverHint>
  ) : (
    <span className="app-default-config-row__title">{title}</span>
  );

  return (
    <div
      className={`app-default-config-row${layout === "stack" ? " app-default-config-row--stack" : ""}`}
      aria-label={ariaLabel ?? title}
    >
      <div className="app-default-config-row__main">
        {titleNode}
        {hint ? <span className="app-default-config-row__hint">{hint}</span> : null}
      </div>
      <div
        className={`app-default-config-row__control${
          layout === "stack" ? " app-default-config-row__control--stack" : ""
        }`}
      >
        {control}
      </div>
    </div>
  );
}
