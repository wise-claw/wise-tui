import { useState } from "react";
import { Button } from "antd";
import { DOCK_SPACING } from "./shared-styles";

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoDockProps {
  items: TodoItem[];
  onToggle: (id: string) => void;
  /** 清空并收起任务列表（不触发折叠行的展开/收起） */
  onClose?: () => void;
}

export function TodoDock({ items, onToggle, onClose }: TodoDockProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (items.length === 0) return null;

  const completed = items.filter((t) => t.status === "completed").length;
  const progress = items.length > 0 ? completed / items.length : 0;

  return (
    <div className="app-claude-dock app-claude-dock--todo" style={{ marginBottom: DOCK_SPACING.tight }}>
      {/* Progress bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 8px",
          background: "var(--ant-color-bg-elevated)",
          border: "1px solid var(--ant-color-border-secondary)",
          borderRadius: "6px 6px 0 0",
          cursor: "pointer",
          fontSize: "11px",
          lineHeight: 1.25,
          color: "var(--ant-color-text-secondary)",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{
          width: "56px",
          height: "3px",
          background: "var(--ant-color-fill)",
          borderRadius: "2px",
          overflow: "hidden",
          flexShrink: 0,
        }}>
          <div style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: "var(--ant-color-primary)",
            borderRadius: "2px",
            transition: "width 0.3s",
          }} />
        </div>
        <span>{completed}/{items.length}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0" }}>
          {onClose ? (
            <Button
              type="text"
              size="small"
              title="关闭任务列表"
              aria-label="关闭任务列表"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                minWidth: 20,
                width: 20,
                height: 20,
                padding: 0,
                marginInlineEnd: 2,
                color: "var(--ant-color-text-tertiary)",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ×
            </Button>
          ) : null}
          <span style={{ fontSize: "9px", opacity: 0.75 }}>{collapsed ? "▼" : "▲"}</span>
        </span>
      </div>

      {!collapsed && (
        <div style={{
          background: "var(--ant-color-bg-elevated)",
          border: "1px solid var(--ant-color-border-secondary)",
          borderTop: "none",
          borderRadius: "0 0 6px 6px",
          padding: "2px",
          maxHeight: "160px",
          overflowY: "auto",
        }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 6px",
                fontSize: "11px",
                lineHeight: 1.35,
                opacity: item.status === "completed" ? 0.6 : 1,
                cursor: "pointer",
              }}
              onClick={() => onToggle(item.id)}
            >
              <span style={{
                width: "12px",
                height: "12px",
                borderRadius: "2px",
                border: "1px solid",
                borderColor: item.status === "completed" ? "var(--ant-color-success)" : "var(--ant-color-border)",
                background: item.status === "completed" ? "var(--ant-color-success)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "8px",
                color: "var(--ant-color-text-light-solid)",
              }}>
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "•" : ""}
              </span>
              <span style={{
                flex: 1,
                textDecoration: item.status === "completed" ? "line-through" : "none",
                color: "var(--ant-color-text)",
              }}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
