import { Input, Modal, Typography } from "antd";
import type { RequirementNameModalMode } from "./types";

interface Props {
  open: boolean;
  mode: RequirementNameModalMode;
  saving: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RequirementNameModal({
  open,
  mode,
  saving,
  value,
  onChange,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal
      title={mode === "create" ? "新增需求" : "填写需求名称"}
      open={open}
      onCancel={() => {
        if (saving) return;
        onCancel();
      }}
      destroyOnHidden
      okText={mode === "create" ? "确认并创建" : "确认并保存"}
      cancelText="取消"
      confirmLoading={saving}
      onOk={onConfirm}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {mode === "create"
          ? "请输入新需求名称，确认后将创建一个空白需求并切换到该需求。"
          : "首次保存需要为当前需求起一个名称，便于区分与检索；之后保存将不再询问。"}
      </Typography.Paragraph>
      <Input
        placeholder="例如：智能待办清单 App PRD"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={120}
        showCount
        onPressEnter={onConfirm}
        autoFocus
      />
    </Modal>
  );
}
