import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { App, AutoComplete, Button, Form, Input, Modal, Segmented } from "antd";
import { useEffect, useMemo, useState } from "react";
import { isSafeExternalHref, openExternalUrl } from "../../services/openExternal";
import { pathIsAccessibleDirectory, pickFolder } from "../../services/repository";
import {
  normalizeWorkspaceQuickActionCategory,
  WORKSPACE_QUICK_ACTION_CATEGORY_MAX_LENGTH,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionKind,
  type WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";

export interface WorkspaceQuickActionsEditModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialItem?: WorkspaceQuickActionItem | null;
  initialScope?: WorkspaceQuickActionScope;
  initialScopeId?: string | null;
  defaultScope: WorkspaceQuickActionScope;
  /** 当前激活的工作区 id；新建时自动归属，不再提供归属选择。 */
  activeProjectId: string | null;
  /** 当前激活的仓库 id；新建时优先归属仓库。 */
  activeRepositoryId: number | null;
  /** 已有分类名，供输入联想。 */
  categoryOptions?: string[];
  compact?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    kind: WorkspaceQuickActionKind;
    label: string;
    target: string;
    category: string;
    scope: WorkspaceQuickActionScope;
    scopeId: string;
  }) => void | Promise<void>;
}

function resolveAutoScope(input: {
  mode: "create" | "edit";
  initialScope?: WorkspaceQuickActionScope;
  initialScopeId?: string | null;
  defaultScope: WorkspaceQuickActionScope;
  activeProjectId: string | null;
  activeRepositoryId: number | null;
}): { scope: WorkspaceQuickActionScope; scopeId: string } | null {
  // 编辑保留原归属；新建落到当前激活仓库，否则工作区。
  if (input.mode === "edit" && input.initialScope && input.initialScopeId?.trim()) {
    return { scope: input.initialScope, scopeId: input.initialScopeId.trim() };
  }
  if (input.defaultScope === "repository" && input.activeRepositoryId != null) {
    return { scope: "repository", scopeId: String(input.activeRepositoryId) };
  }
  if (input.activeRepositoryId != null) {
    return { scope: "repository", scopeId: String(input.activeRepositoryId) };
  }
  const projectId = input.activeProjectId?.trim();
  if (projectId) {
    return { scope: "project", scopeId: projectId };
  }
  return null;
}

export function WorkspaceQuickActionsEditModal({
  open,
  mode,
  initialItem,
  initialScope,
  initialScopeId,
  defaultScope,
  activeProjectId,
  activeRepositoryId,
  categoryOptions,
  compact = false,
  onClose,
  onSubmit,
}: WorkspaceQuickActionsEditModalProps) {
  const { message } = App.useApp();
  const [kind, setKind] = useState<WorkspaceQuickActionKind>("link");
  const [scope, setScope] = useState<WorkspaceQuickActionScope>(defaultScope);
  const [scopeId, setScopeId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const categorySelectOptions = useMemo(
    () =>
      (categoryOptions ?? [])
        .map((value) => normalizeWorkspaceQuickActionCategory(value))
        .filter(Boolean)
        .map((value) => ({ value })),
    [categoryOptions],
  );

  useEffect(() => {
    if (!open) return;
    setKind(initialItem?.kind ?? "link");
    const resolved = resolveAutoScope({
      mode,
      initialScope,
      initialScopeId,
      defaultScope,
      activeProjectId,
      activeRepositoryId,
    });
    setScope(resolved?.scope ?? defaultScope);
    setScopeId(resolved?.scopeId ?? "");
    setLabel(initialItem?.label ?? "");
    setTarget(initialItem?.target ?? "");
    setCategory(normalizeWorkspaceQuickActionCategory(initialItem?.category));
    setSubmitting(false);
  }, [
    open,
    mode,
    initialItem,
    initialScope,
    initialScopeId,
    defaultScope,
    activeProjectId,
    activeRepositoryId,
  ]);

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) setTarget(picked);
  }

  async function handleOk() {
    const trimmedLabel = label.trim();
    const trimmedTarget = target.trim();
    const trimmedCategory = normalizeWorkspaceQuickActionCategory(category);
    if (!scopeId) {
      message.warning("请先在左侧选择工作区或仓库");
      return;
    }
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
        category: trimmedCategory,
        scope,
        scopeId,
      });
      onClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "快捷操作保存失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const categoryField = (
    <Form.Item label="分类" extra={compact ? undefined : "可选；用于弹窗分组展示，与仓库无关"}>
      <AutoComplete
        value={category}
        options={categorySelectOptions}
        placeholder="例如：文档、工具"
        maxLength={WORKSPACE_QUICK_ACTION_CATEGORY_MAX_LENGTH}
        allowClear
        onChange={(value) => setCategory(typeof value === "string" ? value : "")}
        filterOption={(inputValue, option) =>
          String(option?.value ?? "")
            .toLowerCase()
            .includes(inputValue.trim().toLowerCase())
        }
      />
    </Form.Item>
  );

  return (
    <Modal
      title={mode === "create" ? "添加快捷操作" : "编辑快捷操作"}
      open={open}
      onCancel={onClose}
      onOk={() => handleOk()}
      okText={mode === "create" ? "添加" : "保存"}
      confirmLoading={submitting}
      destroyOnHidden
      width={compact ? 440 : 460}
      className={
        compact
          ? "app-workspace-quick-actions-edit-modal app-workspace-quick-actions-edit-modal--compact"
          : "app-workspace-quick-actions-edit-modal"
      }
    >
      <Form
        layout={compact ? "horizontal" : "vertical"}
        className="app-workspace-quick-actions-edit-modal__form"
      >
        {compact ? (
          <div className="app-workspace-quick-actions-edit-modal__rows">
            <Form.Item label="类型">
              <Segmented
                size="small"
                value={kind}
                options={[
                  { label: "链接", value: "link", icon: <LinkOutlined /> },
                  { label: "目录", value: "directory", icon: <FolderOpenOutlined /> },
                ]}
                onChange={(value) => setKind(value as WorkspaceQuickActionKind)}
              />
            </Form.Item>
            {categoryField}
            <Form.Item label="名称" required>
              <Input
                value={label}
                placeholder="例如：设计稿"
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={kind === "link" ? "链接地址" : "目录路径"} required>
              <div className="app-workspace-quick-actions-edit-modal__target-row">
                <Input
                  value={target}
                  placeholder={kind === "link" ? "https://..." : "/path/to/folder"}
                  onChange={(event) => setTarget(event.target.value)}
                />
                {kind === "directory" ? (
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void handlePickFolder()}>
                    选择
                  </Button>
                ) : null}
              </div>
            </Form.Item>
          </div>
        ) : (
          <>
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
            {categoryField}
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
          </>
        )}
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
