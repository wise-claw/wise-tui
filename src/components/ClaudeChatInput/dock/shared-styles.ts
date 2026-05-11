import type { CSSProperties } from "react";

export const DOCK_SPACING = {
  tight: "4px",
  compact: "6px",
  normal: "8px",
} as const;

export const DOCK_TITLE_STYLE: CSSProperties = {
  margin: `0 0 ${DOCK_SPACING.normal}`,
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--ant-color-text)",
};

export const DOCK_SECONDARY_TEXT_STYLE: CSSProperties = {
  fontSize: "12px",
  color: "var(--ant-color-text-secondary)",
};

export const DOCK_ACTION_ROW_STYLE: CSSProperties = {
  display: "flex",
  gap: "6px",
  justifyContent: "flex-end",
};

export const DOCK_STATUS_ROW_BASE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

export const QUESTION_OPTION_LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  marginBottom: DOCK_SPACING.normal,
};

export const QUESTION_OPTION_ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "12px",
  background: "var(--ant-color-fill-quaternary)",
};

export const PERMISSION_FILE_PATTERN_LIST_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  marginBottom: DOCK_SPACING.compact,
};

export const PERMISSION_FILE_PATTERN_ITEM_STYLE: CSSProperties = {
  fontSize: "11px",
  padding: "1px 4px",
  background: "var(--ant-color-fill-quaternary)",
  borderRadius: "3px",
  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
};
