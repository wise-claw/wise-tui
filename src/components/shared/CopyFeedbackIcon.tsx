import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";

interface Props {
  copied: boolean;
  style?: CSSProperties;
}

export function CopyFeedbackIcon({ copied, style }: Props) {
  if (copied) {
    return <CheckOutlined style={{ color: "var(--ant-color-success)", ...style }} />;
  }
  return <CopyOutlined style={style} />;
}
