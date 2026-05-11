import { useState } from "react";
import { Button } from "antd";
import { DOCK_SPACING } from "./shared-styles";

interface Props {
  items: { id: string; text: string }[];
  onSend: (id: string) => void;
  onEdit: (id: string) => void;
  /** 清空本会话全部跟进建议 */
  onClose?: () => void;
}

const linkBtnCompact = {
  fontSize: "11px",
  height: "22px",
  padding: "0 4px",
  lineHeight: 1.25,
} as const;

export function FollowupDock({ items, onSend, onEdit, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div
      className="app-claude-dock app-claude-dock--followup"
      style={{ marginBottom: DOCK_SPACING.tight }}
    >
      <div className="app-followup-head">
        <button
          type="button"
          className="app-followup-head__main"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="app-followup-head__label">
            跟进建议
            <span className="app-followup-head__count">· {items.length}</span>
          </span>
          <span className="app-followup-head__chevron" aria-hidden>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>
        {onClose ? (
          <Button
            type="text"
            size="small"
            title="关闭跟进建议"
            aria-label="关闭跟进建议"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              minWidth: 20,
              width: 20,
              height: 20,
              padding: 0,
              color: "var(--ant-color-text-tertiary)",
              fontSize: 12,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </Button>
        ) : null}
      </div>
      {!collapsed && (
        <div className="app-followup-list">
          {items.map((item) => (
            <div key={item.id} className="app-followup-item">
              <span className="app-followup-item__text" title={item.text}>
                {item.text}
              </span>
              <Button size="small" type="link" style={linkBtnCompact} onClick={() => onSend(item.id)}>
                发送
              </Button>
              <Button size="small" type="link" style={linkBtnCompact} onClick={() => onEdit(item.id)}>
                编辑
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
