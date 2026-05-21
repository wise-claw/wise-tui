import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Modal, Segmented, Switch, Tag } from "antd";
import {
  moveLayoutItem,
  SESSION_QUICK_ACTION_META,
  updateLayoutItem,
  type SessionQuickActionId,
  type SessionQuickActionLayoutItem,
  type SessionQuickActionsAvailability,
  type SessionQuickActionsLayoutV1,
  isSessionQuickActionAvailable,
} from "../../constants/sessionQuickActionsLayout";

export interface SessionQuickActionsCustomizeModalProps {
  open: boolean;
  onClose: () => void;
  layout: SessionQuickActionsLayoutV1;
  onLayoutChange: (next: SessionQuickActionsLayoutV1) => void;
  onReset: () => void;
  availability: SessionQuickActionsAvailability;
}

export function SessionQuickActionsCustomizeModal({
  open,
  onClose,
  layout,
  onLayoutChange,
  onReset,
  availability,
}: SessionQuickActionsCustomizeModalProps) {
  const items = layout.items;

  const patchItem = (id: SessionQuickActionId, patch: Partial<Pick<SessionQuickActionLayoutItem, "visible" | "zone">>) => {
    onLayoutChange(updateLayoutItem(layout, id, patch));
  };

  const moveItem = (id: SessionQuickActionId, direction: "up" | "down") => {
    onLayoutChange(moveLayoutItem(layout, id, direction));
  };

  return (
    <Modal
      title="自定义快捷操作"
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="完成"
      cancelButtonProps={{ style: { display: "none" } }}
      width={400}
      destroyOnHidden
      className="app-session-quick-customize-modal"
      footer={
        <div className="app-session-quick-customize-modal__footer">
          <Button type="link" onClick={onReset}>
            恢复默认
          </Button>
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        </div>
      }
    >
      <p className="app-session-quick-customize-modal__hint">
        开关显示 · 外显/更多 · ↑↓ 排序；不可用项可预配。调整会自动写入本地数据库（~/.wise/wise.db）。
      </p>
      <ul className="app-session-quick-customize-modal__list">
        {items.map((item, index) => {
          const meta = SESSION_QUICK_ACTION_META[item.id];
          const available = isSessionQuickActionAvailable(item.id, availability);
          return (
            <li key={item.id} className="app-session-quick-customize-modal__row">
              <span className="app-session-quick-customize-modal__label" title={meta.label}>
                {meta.label}
                {!available ? (
                  <Tag className="app-session-quick-customize-modal__tag" bordered={false}>
                    不可用
                  </Tag>
                ) : null}
              </span>
              <Switch
                size="small"
                className="app-session-quick-customize-modal__visible"
                checked={item.visible}
                aria-label={`${meta.label} 显示`}
                onChange={(checked) => patchItem(item.id, { visible: checked })}
              />
              <Segmented
                size="small"
                className="app-session-quick-customize-modal__zone"
                disabled={!item.visible}
                value={item.zone}
                options={[
                  { label: "外显", value: "primary" },
                  { label: "更多", value: "overflow" },
                ]}
                onChange={(value) => {
                  if (value === "primary" || value === "overflow") {
                    patchItem(item.id, { zone: value });
                  }
                }}
              />
              <div className="app-session-quick-customize-modal__sort">
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  aria-label={`${meta.label} 上移`}
                  onClick={() => moveItem(item.id, "up")}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={index === items.length - 1}
                  aria-label={`${meta.label} 下移`}
                  onClick={() => moveItem(item.id, "down")}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
