import { Modal, Select, Typography } from "antd";
import type { ProjectPrdLinkKind, ProjectPrdScopeLinkOption } from "./useProjectPrdScopeLinks";

interface Props {
  open: boolean;
  kind: ProjectPrdLinkKind;
  saving: boolean;
  selection: string | null;
  options: ProjectPrdScopeLinkOption[];
  onCancel: () => void;
  onChange: (value: string | null) => void;
  onConfirm: () => void;
}

export function ProjectPrdScopeLinkModal({
  open,
  kind,
  saving,
  selection,
  options,
  onCancel,
  onChange,
  onConfirm,
}: Props) {
  return (
    <Modal
      title={kind === "employee" ? "关联已有员工" : "关联已有团队"}
      open={open}
      onCancel={onCancel}
      destroyOnClose
      okText="关联"
      cancelText="取消"
      confirmLoading={saving}
      onOk={onConfirm}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        将侧栏已有员工或团队模板关联到当前项目，便于在需求顶栏查看；新建请使用右侧「+」打开与仓库一致的全局配置。
      </Typography.Paragraph>
      <Select
        showSearch
        allowClear
        optionFilterProp="label"
        placeholder={kind === "employee" ? "选择员工" : "选择团队"}
        style={{ width: "100%" }}
        value={selection ?? undefined}
        onChange={(value) => onChange(value ?? null)}
        options={options}
      />
      {options.length === 0 ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {kind === "employee" ? "没有可关联的员工（均已关联或已禁用）。" : "没有可关联的团队（均已关联）。"}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
