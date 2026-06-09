import type { CSSProperties } from "react";
import { HoverHint } from "../../shared/HoverHint";
import { Tag } from "antd";
import type { ControlRequestStatus } from "../../../notifications";
import { DOCK_SECONDARY_TEXT_STYLE, DOCK_SPACING, DOCK_STATUS_ROW_BASE_STYLE } from "./shared-styles";

interface ControlRequestStatusHintProps {
  status?: ControlRequestStatus | null;
  errorText?: string | null;
  failedFallbackText: string;
  expiredText: string;
  density?: "compact" | "normal";
  /** `none`：过期态由调用方展示（如标题行 + Popover），此处不再渲染横幅。 */
  expiredPresentation?: "banner" | "none";
}

const HINT_TEXT_STYLE: CSSProperties = DOCK_SECONDARY_TEXT_STYLE;

const ERROR_TEXT_STYLE: CSSProperties = {
  ...HINT_TEXT_STYLE,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "320px",
  display: "inline-block",
  verticalAlign: "bottom",
};

export function ControlRequestStatusHint({
  status,
  errorText,
  failedFallbackText,
  expiredText,
  density = "normal",
  expiredPresentation = "banner",
}: ControlRequestStatusHintProps) {
  const marginBottom = density === "compact" ? DOCK_SPACING.compact : DOCK_SPACING.normal;
  if (status === "failed") {
    const content = errorText || failedFallbackText;
    return (
      <div style={{ ...DOCK_STATUS_ROW_BASE_STYLE, marginBottom }}>
        <Tag color="error" style={{ marginInlineEnd: 0, fontSize: 11 }}>发送失败</Tag>
        <HoverHint title={content}>
          <span style={ERROR_TEXT_STYLE}>{content}</span>
        </HoverHint>
      </div>
    );
  }

  if (status === "expired") {
    if (expiredPresentation === "none") return null;
    return (
      <div style={{ ...DOCK_STATUS_ROW_BASE_STYLE, marginBottom }}>
        <Tag color="default" style={{ marginInlineEnd: 0, fontSize: 11 }}>已过期</Tag>
        <span style={HINT_TEXT_STYLE}>{expiredText}</span>
      </div>
    );
  }

  return null;
}
