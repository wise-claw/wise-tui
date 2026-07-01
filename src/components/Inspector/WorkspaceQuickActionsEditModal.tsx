import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Segmented, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import { isSafeExternalHref, openExternalUrl } from "../../services/openExternal";
import { pathIsAccessibleDirectory, pickFolder } from "../../services/repository";
import type {
  WorkspaceQuickActionItem,
  WorkspaceQuickActionKind,
  WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";
import type { Repository, Workspace } from "../../types";

export interface WorkspaceQuickActionsEditModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialItem?: WorkspaceQuickActionItem | null;
  initialScope?: WorkspaceQuickActionScope;
  initialScopeId?: string | null;
  defaultScope: WorkspaceQuickActionScope;
  /** 当前激活的工作区 id，用于编辑模式下 scope 解析与默认选中 */
  activeProjectId: string | null;
  /** 当前激活的仓库 id，用于编辑模式下 scope 解析与默认选中 */
  activeRepositoryId: number | null;
  /** 可选工作区集合（添加新条目时使用）。缺省时 Modal 回退到原「工作区/仓库」二选一。 */
  workspaces?: Workspace[];
  /** 工作区内仓库（按 id 索引）。 */
  repositoriesById?: Map<number, Repository>;
  /** 浮动仓库（未绑定工作区的仓库）。 */
  floatingRepositories?: Repository[];
  compact?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    kind: WorkspaceQuickActionKind;
    label: string;
    target: string;
    scope: WorkspaceQuickActionScope;
    scopeId: string;
  }) => void | Promise<void>;
}

interface ScopeOption {
  value: string;
  scope: WorkspaceQuickActionScope;
  label: React.ReactNode;
}

function encodeScopeOptionValue(scope: WorkspaceQuickActionScope, scopeId: string): string {
  return `${scope}::${scopeId}`;
}

function decodeScopeOptionValue(
  raw: string,
): { scope: WorkspaceQuickActionScope; scopeId: string } | null {
  const [scope, scopeId] = raw.split("::");
  if ((scope !== "project" && scope !== "repository") || !scopeId) return null;
  return { scope, scopeId };
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
  workspaces,
  repositoriesById,
  floatingRepositories,
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
  const [submitting, setSubmitting] = useState(false);

  const scopeOptions = useMemo<ScopeOption[]>(() => {
    // 缺省数据时仅展示当前激活 scope（沿用旧「工作区/仓库」二选一体验）
    const safeWorkspaces = workspaces ?? [];
    const safeReposById = repositoriesById ?? new Map<number, Repository>();
    const safeFloating = floatingRepositories ?? [];

    const projectOptions: ScopeOption[] = safeWorkspaces.map((project) => ({
      value: encodeScopeOptionValue("project", project.id),
      scope: "project" as const,
      label: (
        <span className="app-workspace-quick-actions-edit-modal__scope-option">
          <span className="app-workspace-quick-actions-edit-modal__scope-tag">工作区</span>
          <span className="app-workspace-quick-actions-edit-modal__scope-name">
            {project.iconDisplayName?.trim() || project.name}
          </span>
        </span>
      ),
    }));
    const seenRepositoryIds = new Set<number>();
    const repositoryOptions: ScopeOption[] = [];
    const pushRepo = (repo: Repository) => {
      if (seenRepositoryIds.has(repo.id)) return;
      seenRepositoryIds.add(repo.id);
      repositoryOptions.push({
        value: encodeScopeOptionValue("repository", String(repo.id)),
        scope: "repository" as const,
        label: (
          <span className="app-workspace-quick-actions-edit-modal__scope-option">
            <span className="app-workspace-quick-actions-edit-modal__scope-tag">仓库</span>
            <span className="app-workspace-quick-actions-edit-modal__scope-name">{repo.name}</span>
          </span>
        ),
      });
    };
    for (const project of safeWorkspaces) {
      for (const id of project.repositoryIds) {
        const repo = safeReposById.get(id);
        if (repo) pushRepo(repo);
      }
    }
    for (const repo of safeFloating) {
      pushRepo(repo);
    }
    const options = [...projectOptions, ...repositoryOptions];
    // 上层未传 workspaces 列表时，用当前 active id 兜底至少 1 项
    if (options.length > 0) return options;
    const fallback: ScopeOption[] = [];
    if (activeProjectId?.trim()) {
      fallback.push({
        value: encodeScopeOptionValue("project", activeProjectId.trim()),
        scope: "project",
        label: (
          <span className="app-workspace-quick-actions-edit-modal__scope-option">
            <span className="app-workspace-quick-actions-edit-modal__scope-tag">工作区</span>
            <span className="app-workspace-quick-actions-edit-modal__scope-name">当前工作区</span>
          </span>
        ),
      });
    }
    if (activeRepositoryId != null) {
      fallback.push({
        value: encodeScopeOptionValue("repository", String(activeRepositoryId)),
        scope: "repository",
        label: (
          <span className="app-workspace-quick-actions-edit-modal__scope-option">
            <span className="app-workspace-quick-actions-edit-modal__scope-tag">仓库</span>
            <span className="app-workspace-quick-actions-edit-modal__scope-name">当前仓库</span>
          </span>
        ),
      });
    }
    return fallback;
  }, [workspaces, repositoriesById, floatingRepositories, activeProjectId, activeRepositoryId]);

  const resolveInitialScopeValue = useMemo(() => {
    const initialScopeValue = initialScope ?? defaultScope;
    // 编辑模式优先用调用方传入的具体 scopeId（item 实际归属的位置）
    if (initialScopeId) {
      return encodeScopeOptionValue(initialScopeValue, initialScopeId);
    }
    if (initialScopeValue === "project") {
      const id = activeProjectId?.trim();
      if (id) return encodeScopeOptionValue("project", id);
    }
    if (initialScopeValue === "repository" && activeRepositoryId != null) {
      return encodeScopeOptionValue("repository", String(activeRepositoryId));
    }
    return null;
  }, [initialScope, initialScopeId, defaultScope, activeProjectId, activeRepositoryId]);

  useEffect(() => {
    if (!open) return;
    setKind(initialItem?.kind ?? "link");
    // 默认 scope 选中：先尝试当前激活，再退回到 options 第一项
    const fallback =
      resolveInitialScopeValue ??
      (scopeOptions[0] ? scopeOptions[0].value : encodeScopeOptionValue(defaultScope, ""));
    const decoded = decodeScopeOptionValue(fallback);
    setScopeId(decoded?.scopeId ?? "");
    setScope(decoded?.scope ?? defaultScope);
    setLabel(initialItem?.label ?? "");
    setTarget(initialItem?.target ?? "");
    setSubmitting(false);
  }, [open, initialItem, defaultScope, resolveInitialScopeValue, scopeOptions]);

  const handleScopeChange = (value: string) => {
    const decoded = decodeScopeOptionValue(value);
    if (!decoded) return;
    setScope(decoded.scope);
    setScopeId(decoded.scopeId);
  };

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) setTarget(picked);
  }

  async function handleOk() {
    const trimmedLabel = label.trim();
    const trimmedTarget = target.trim();
    if (!scopeId) {
      message.warning("请选择归属工作区或仓库");
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
            {scopeOptions.length > 0 ? (
              <Form.Item label="归属" required>
                <Select
                  size="small"
                  value={encodeScopeOptionValue(scope, scopeId)}
                  onChange={handleScopeChange}
                  options={scopeOptions}
                  placeholder="选择工作区或仓库"
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
            ) : null}
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
            <Form.Item label="名称" required>
              <Input
                value={label}
                placeholder="例如：设计稿"
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Form.Item>
            <Form.Item
              label={kind === "link" ? "链接地址" : "目录路径"}
              required
            >
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
            {scopeOptions.length > 0 ? (
              <Form.Item label="归属" required>
                <Select
                  value={encodeScopeOptionValue(scope, scopeId)}
                  onChange={handleScopeChange}
                  options={scopeOptions}
                  placeholder="选择工作区或仓库"
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={false}
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