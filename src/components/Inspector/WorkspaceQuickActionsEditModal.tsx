import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Segmented } from "antd";
import { useEffect, useState } from "react";
import { isSafeExternalHref, openExternalUrl } from "../../services/openExternal";
import { pathIsAccessibleDirectory, pickFolder } from "../../services/repository";
import type {
  WorkspaceQuickActionItem,
  WorkspaceQuickActionKind,
  WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";

export interface WorkspaceQuickActionsEditModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialItem?: WorkspaceQuickActionItem | null;
  initialScope?: WorkspaceQuickActionScope;
  defaultScope: WorkspaceQuickActionScope;
  allowProjectScope: boolean;
  allowRepositoryScope: boolean;
  onClose: () => void;
  onSubmit: (input: {
    kind: WorkspaceQuickActionKind;
    label: string;
    target: string;
    scope: WorkspaceQuickActionScope;
  }) => void | Promise<void>;
}

export function WorkspaceQuickActionsEditModal({
  open,
  mode,
  initialItem,
  initialScope,
  defaultScope,
  allowProjectScope,
  allowRepositoryScope,
  onClose,
  onSubmit,
}: WorkspaceQuickActionsEditModalProps) {
  const { message } = App.useApp();
  const [kind, setKind] = useState<WorkspaceQuickActionKind>("link");
  const [scope, setScope] = useState<WorkspaceQuickActionScope>(defaultScope);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialItem?.kind ?? "link");
    setScope(initialScope ?? defaultScope);
    setLabel(initialItem?.label ?? "");
    setTarget(initialItem?.target ?? "");
    setSubmitting(false);
  }, [open, initialItem, initialScope, defaultScope]);

  const scopeOptions = [
    allowProjectScope ? { label: "工作区", value: "project" as const } : null,
    allowRepositoryScope ? { label: "仓库", value: "repository" as const } : null,
  ].filter((row): row is { label: string; value: WorkspaceQuickActionScope } => row != null);

  const effectiveScope =
    scopeOptions.find((row) => row.value === scope)?.value ?? scopeOptions[0]?.value ?? defaultScope;

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) setTarget(picked);
  }

  async function handleOk() {
    const trimmedLabel = label.trim();
    const trimmedTarget = target.trim();
    if (!trimmedLabel) {
      message.warning("请填写名称");
      return;
    }
    if (!trimmedTarget) {
      message.warning(kind === "link" ? "请填写链接地址" : "请填写目录路径");
      return;
    }
    if (kind === "link" && !isSafeExternalHref(trimmedTarget)) {
      message.warning("链接需以 http://、https://、mailto: 或 tel: 开头");
      return;
    }
    if (kind === "directory") {
      const ok = await pathIsAccessibleDirectory(trimmedTarget);
      if (!ok) {
        message.warning("目录不存在或无法访问");
        return;
      }
    }
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        label: trimmedLabel,
        target: trimmedTarget,
        scope: effectiveScope,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={mode === "create" ? "添加快捷操作" : "编辑快捷操作"}
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      okText={mode === "create" ? "添加" : "保存"}
      confirmLoading={submitting}
      destroyOnHidden
      width={420}
      className="app-workspace-quick-actions-edit-modal"
    >
      <Form layout="vertical" className="app-workspace-quick-actions-edit-modal__form">
        {scopeOptions.length > 1 ? (
          <Form.Item label="归属">
            <Segmented
              value={effectiveScope}
              options={scopeOptions}
              onChange={(value) => setScope(value as WorkspaceQuickActionScope)}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="类型">
          <Segmented
            value={kind}
            options={[
              { label: "链接", value: "link", icon: <LinkOutlined /> },
              { label: "本地目录", value: "directory", icon: <FolderOpenOutlined /> },
            ]}
            onChange={(value) => setKind(value as WorkspaceQuickActionKind)}
          />
        </Form.Item>
        <Form.Item label="名称" required>
          <Input
            value={label}
            placeholder="例如：设计稿、日志目录"
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label={kind === "link" ? "链接地址" : "目录路径"}
          required
          extra={
            kind === "link"
              ? "支持 http(s) / mailto / tel"
              : "将在 Finder 中打开该目录"
          }
        >
          <div className="app-workspace-quick-actions-edit-modal__target-row">
            <Input
              value={target}
              placeholder={kind === "link" ? "https://..." : "/path/to/folder"}
              onChange={(event) => setTarget(event.target.value)}
            />
            {kind === "directory" ? (
              <Button icon={<FolderOpenOutlined />} onClick={() => void handlePickFolder()}>
                选择
              </Button>
            ) : null}
          </div>
        </Form.Item>
        {mode === "edit" && initialItem?.kind === "link" && isSafeExternalHref(initialItem.target) ? (
          <Button
            type="link"
            size="small"
            className="app-workspace-quick-actions-edit-modal__preview-link"
            onClick={() => void openExternalUrl(initialItem.target)}
          >
            预览当前链接
          </Button>
        ) : null}
      </Form>
    </Modal>
  );
}
