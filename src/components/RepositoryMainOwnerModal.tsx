import { AutoComplete, Modal, Typography } from "antd";
import { useEffect, useState } from "react";
import type { Repository } from "../types";
import { repositoryFolderBasename } from "../utils/repositoryType";

export interface RepositoryMainOwnerModalProps {
  open: boolean;
  repository: Repository | null;
  agentNameOptions: string[];
  onClose: () => void;
  onSave: (repository: Repository, mainOwnerAgentName: string | null) => Promise<void>;
}

export function RepositoryMainOwnerModal({
  open,
  repository,
  agentNameOptions,
  onClose,
  onSave,
}: RepositoryMainOwnerModalProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open && repository) {
      setValue(repository.mainOwnerAgentName?.trim() ?? "");
    }
  }, [open, repository]);

  const title = repository ? `主 Owner 智能体 · ${repositoryFolderBasename(repository)}` : "主 Owner 智能体";

  return (
    <Modal
      title={title}
      open={open}
      okText="保存"
      cancelText="取消"
      onCancel={onClose}
      destroyOnClose
      onOk={async () => {
        if (!repository) return;
        const trimmed = value.trim();
        await onSave(repository, trimmed.length > 0 ? trimmed : null);
        onClose();
      }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        须与 Claude 标签展示名中「…/员工:」后的名称一致（例如 executor）。留空则侧栏点仓库仍打开人类主会话。
      </Typography.Paragraph>
      <AutoComplete
        style={{ width: "100%" }}
        value={value}
        onChange={(v) => setValue(String(v))}
        options={agentNameOptions.map((n) => ({ value: n }))}
        placeholder="选择或输入智能体名称"
        allowClear
      />
    </Modal>
  );
}
