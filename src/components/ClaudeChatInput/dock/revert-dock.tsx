import { useState } from "react";
import { Button } from "antd";
import { DOCK_SPACING } from "./shared-styles";

interface Props {
  items: { id: string; text: string }[];
  disabled?: boolean;
  /** 选中某条回退点：应发送用户消息触发恢复，成功后再从 Dock 移除 */
  onRestore: (id: string) => void | Promise<void>;
  /** 关闭并清空本会话全部回退点提示（不发送消息） */
  onClose?: () => void;
}

const linkBtnCompact = {
  fontSize: "11px",
  height: "22px",
  padding: "0 4px",
  lineHeight: 1.25,
} as const;

export function RevertDock({ items, disabled, onRestore, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function handleRestore(id: string) {
    if (restoringId !== null || disabled) return;
    setRestoringId(id);
    try {
      await Promise.resolve(onRestore(id));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="app-claude-dock app-claude-dock--revert" style={{ marginBottom: DOCK_SPACING.tight }}>
      <div className="app-followup-head">
        <button
          type="button"
          className="app-followup-head__main"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="app-followup-head__label">
            回退点
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
            title="关闭回退点"
            aria-label="关闭回退点"
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
              <Button
                size="small"
                type="link"
                style={linkBtnCompact}
                disabled={disabled || restoringId === item.id}
                loading={restoringId === item.id}
                onClick={() => {
                  void handleRestore(item.id);
                }}
              >
                恢复
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
