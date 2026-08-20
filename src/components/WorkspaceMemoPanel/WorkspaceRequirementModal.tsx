import { Button, Modal, Select, Space, Spin, Typography, message } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatchRequirementToExecutionEnvironment } from "../../constants/pendingTaskQueueEvents";
import { readComposerImageAsDataUrl } from "../../services/readComposerImage";
import {
  buildRequirementDispatchPayload,
  countMarkdownImages,
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import {
  appendWorkspaceRequirement,
  loadWorkspaceRequirements,
  updateWorkspaceRequirement,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
} from "../../services/workspaceRequirementsStore";
import {
  closeWorkspaceRequirementCreateModal,
  closeWorkspaceRequirementEditModal,
  useWorkspaceRequirementCreateModalDefaultRepositoryId,
  useWorkspaceRequirementCreateModalEpoch,
  useWorkspaceRequirementCreateModalOpen,
  useWorkspaceRequirementEditModalEpoch,
  useWorkspaceRequirementEditModalOpen,
  useWorkspaceRequirementEditModalRequirementId,
} from "../../stores/workspaceMemoPanelStore";
import type { Repository } from "../../types";
import {
  createWorkspaceRequirementItem,
  deriveRequirementTitle,
  type WorkspaceRequirementItem,
  type WorkspaceRequirementsPayloadV1,
} from "../../types/workspaceRequirements";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { ErrorBoundary } from "../ErrorBoundary";
import "./index.css";
import type { TiptapEditorProps } from "../TiptapEditor";

const TiptapEditor = lazy(() =>
  import("../TiptapEditor").then((module) => ({ default: module.TiptapEditor })),
);

function RequirementRichTextEditor({
  editorKey,
  initialBody,
  onChange,
  mentionSuggestions,
}: {
  editorKey: number;
  initialBody: string;
  onChange: (markdown: string) => void;
  mentionSuggestions?: TiptapEditorProps["mentionSuggestions"];
}) {
  return (
    <div className="app-workspace-requirements-panel__editor-wrap">
      <TiptapEditor
        key={editorKey}
        text={initialBody}
        onChange={onChange}
        floatingToolbar
        mentionSuggestions={mentionSuggestions}
      />
    </div>
  );
}

function resolveDefaultRepositoryId(
  preferred: string | null,
  activeRepositoryId: number | null,
  repositories: Repository[],
): string | null {
  if (preferred) {
    const match = repositories.find((repo) => String(repo.id) === preferred);
    if (match) return String(match.id);
  }
  if (activeRepositoryId != null) {
    const match = repositories.find((repo) => repo.id === activeRepositoryId);
    if (match) return String(match.id);
  }
  return repositories[0] != null ? String(repositories[0].id) : null;
}

/**
 * 保存后派发：组装图文 → 派发到执行环境 → 标记已派发。
 * 返回是否被执行环境接收（未接收时需求已保存，仅未派发）。
 */
async function dispatchSavedRequirementToEnvironment(
  savedItem: WorkspaceRequirementItem,
  dispatchedAt: number,
): Promise<boolean> {
  const payload = await buildRequirementDispatchPayload(savedItem);
  const accepted = dispatchRequirementToExecutionEnvironment({
    promptText: payload.promptText,
    userBubblePrompt: payload.executeBubbleOptions?.userBubblePrompt ?? payload.promptText,
    source: "workspace-requirement",
    requirementId: savedItem.id,
    requirementRepositoryId: savedItem.repositoryId,
  });
  if (accepted) {
    await updateWorkspaceRequirement(savedItem.id, (row) => ({
      ...row,
      lastDispatchedAt: dispatchedAt,
      dispatchAttemptCount: (row.dispatchAttemptCount ?? 0) + 1,
    }));
  }
  return accepted;
}

/** 把已落盘的 `@绝对路径` 图片读回 data URL，供编辑器展示。 */
async function hydrateMarkdownImagesForEditor(markdown: string): Promise<string> {
  let next = markdown;
  // Markdown 图片语法
  const paths = [...markdown.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)\)/g)].map((m) => m[1]!.trim());
  for (const path of paths) {
    if (!path.startsWith("/")) continue;
    const dataUrl = await readComposerImageAsDataUrl(path);
    if (!dataUrl) continue;
    next = next.split(`](${path})`).join(`](${dataUrl})`);
  }
  // HTML <img src="/abs">（Tiptap 图片带尺寸/对齐时的序列化形式）
  for (const match of [...next.matchAll(/<img\b[^>]*?\bsrc="(\/[^"]+)"[^>]*>/gi)]) {
    const full = match[0]!;
    const path = match[1]!.trim();
    if (!path.startsWith("/")) continue;
    const dataUrl = await readComposerImageAsDataUrl(path);
    if (!dataUrl) continue;
    next = next.replace(full, full.replace(`src="${path}"`, `src="${dataUrl}"`));
  }
  return next;
}

export type WorkspaceRequirementModalProps = {
  repositories: Repository[];
  activeRepositoryId: number | null;
  /** @ 终端提及数据源（与会话输入框同款）。 */
  employees?: Array<{ id: string; name: string }>;
  /** @ 工作流提及数据源（与会话输入框同款）。 */
  workflowTemplates?: Array<{ id: string; name: string }>;
  /** 当前会话执行引擎：决定需求编辑器 `/` 补全展示哪套内置命令（与会话输入框一致）。 */
  sessionExecutionEngine?: SessionExecutionEngine;
  /** @ 终端可用的执行引擎（与会话输入框同款，缺省仅展示 Claude）。 */
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
};

/**
 * 全局「新增 / 编辑需求」弹窗：按 store 状态复用同一套编辑器 / 归属仓库 / 图片落盘流程。
 * 新增与编辑均支持「保存并派发」。
 */
export function WorkspaceRequirementModal({
  repositories,
  activeRepositoryId,
  employees,
  workflowTemplates,
  sessionExecutionEngine,
  codexAvailable,
  cursorAvailable,
  geminiAvailable,
  opencodeAvailable,
  qoderAvailable,
}: WorkspaceRequirementModalProps) {
  const createOpen = useWorkspaceRequirementCreateModalOpen();
  const createEpoch = useWorkspaceRequirementCreateModalEpoch();
  const preferredRepositoryId = useWorkspaceRequirementCreateModalDefaultRepositoryId();
  const editOpen = useWorkspaceRequirementEditModalOpen();
  const editEpoch = useWorkspaceRequirementEditModalEpoch();
  const requirementId = useWorkspaceRequirementEditModalRequirementId();

  const mode: "create" | "edit" = editOpen ? "edit" : "create";
  const open = createOpen || editOpen;
  const editorKey = mode === "edit" ? editEpoch : createEpoch;

  const [draftBody, setDraftBody] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftBodyRef = useRef("");
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setDraftBody("");
    draftBodyRef.current = "";
    setRepositoryId(null);
    setLoadingItem(false);
    if (mode === "create") {
      setRepositoryId(
        resolveDefaultRepositoryId(preferredRepositoryId, activeRepositoryId, repositories),
      );
    }
  }, [open, mode, editorKey, preferredRepositoryId, activeRepositoryId, repositories]);

  useEffect(() => {
    if (mode !== "edit" || !open || !requirementId) return;
    const gen = ++loadGenRef.current;
    setLoadingItem(true);

    void loadWorkspaceRequirements()
      .then(async (payload) => {
        if (loadGenRef.current !== gen) return;
        const item = payload.items.find((row) => row.id === requirementId);
        if (!item) {
          message.warning("未找到要编辑的需求");
          closeWorkspaceRequirementEditModal();
          return;
        }
        const body = item.bodyMarkdown || item.description || item.title;
        const existingRepoId =
          typeof item.repositoryId === "string" && item.repositoryId.trim()
            ? item.repositoryId.trim()
            : null;
        setDraftBody(body);
        draftBodyRef.current = body;
        setRepositoryId(existingRepoId);
        const hydrated = await hydrateMarkdownImagesForEditor(body);
        if (loadGenRef.current !== gen) return;
        if (draftBodyRef.current !== body) return;
        setDraftBody(hydrated);
        draftBodyRef.current = hydrated;
      })
      .catch((err) => {
        if (loadGenRef.current !== gen) return;
        console.error("[WorkspaceRequirements] edit modal load failed", err);
        message.error("加载需求失败");
        closeWorkspaceRequirementEditModal();
      })
      .finally(() => {
        if (loadGenRef.current === gen) setLoadingItem(false);
      });
  }, [mode, open, editorKey, requirementId]);

  useEffect(() => {
    if (mode !== "edit" || !open) return;
    function onRequirementsChanged(event: Event) {
      const detail = (event as CustomEvent<WorkspaceRequirementsPayloadV1>).detail;
      if (!detail || !Array.isArray(detail.items) || !requirementId) return;
      const stillExists = detail.items.some((row) => row.id === requirementId);
      if (!stillExists) {
        message.warning("该需求已被删除");
        closeWorkspaceRequirementEditModal();
      }
    }
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);
    return () => {
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);
    };
  }, [mode, open, requirementId]);

  const repositoryOptions = useMemo(() => {
    const options = repositories.map((repo) => ({
      value: String(repo.id),
      label: repositoryFolderBasename(repo),
    }));
    if (mode === "edit" && repositoryId && !options.some((option) => option.value === repositoryId)) {
      options.unshift({
        value: repositoryId,
        label: `未知仓库 (${repositoryId})`,
      });
    }
    return options;
  }, [repositories, repositoryId, mode]);

  const mentionSuggestions = useMemo(
    () => ({
      repositoryPath:
        repositories.find((repo) => String(repo.id) === repositoryId)?.path ?? null,
      employees: employees?.map((item) => ({ id: item.id, name: item.name })),
      teams: workflowTemplates?.map((item) => ({ id: item.id, name: item.name })),
      sessionExecutionEngine,
      codexAvailable,
      cursorAvailable,
      geminiAvailable,
      opencodeAvailable,
      qoderAvailable,
    }),
    [
      repositories,
      repositoryId,
      employees,
      workflowTemplates,
      sessionExecutionEngine,
      codexAvailable,
      cursorAvailable,
      geminiAvailable,
      opencodeAvailable,
      qoderAvailable,
    ],
  );

  const handleClose = useCallback(() => {
    if (mode === "edit") {
      closeWorkspaceRequirementEditModal();
    } else {
      closeWorkspaceRequirementCreateModal();
    }
  }, [mode]);

  const handleSave = useCallback(
    async (dispatchAfterSave: boolean) => {
      if (mode === "edit" && !requirementId) return;
      const rawBody = draftBodyRef.current.trim();
      if (!rawBody) {
        message.warning("请填写需求图文内容（可粘贴/拖入图片）");
        return;
      }
      if (!repositoryId) {
        message.warning("请选择归属仓库");
        return;
      }
      const repoExists = repositories.some((repo) => String(repo.id) === repositoryId);
      if (!repoExists) {
        message.warning("所选仓库不存在，请重新选择");
        return;
      }
      setSaving(true);
      try {
        const materialized = await materializeRequirementBodyImages(rawBody);
        if (!stripMarkdownImages(materialized.bodyMarkdown) && materialized.imagePaths.length === 0) {
          message.warning("请填写文字或插入图片");
          return;
        }
        const title = deriveRequirementTitle(materialized.bodyMarkdown);
        const now = Date.now();

        if (mode === "create") {
          const created = createWorkspaceRequirementItem(materialized.bodyMarkdown, now, repositoryId);
          created.title = title;
          created.imagePaths = materialized.imagePaths;
          const saved = await appendWorkspaceRequirement(created);
          if (!dispatchAfterSave) {
            message.success("需求已新增");
            closeWorkspaceRequirementCreateModal();
            return;
          }
          const savedItem = saved.items.find((row) => row.id === created.id);
          if (!savedItem) {
            message.error("新增成功但未找到需求，请稍后在面板中重新派发");
            return;
          }
          const accepted = await dispatchSavedRequirementToEnvironment(savedItem, now);
          if (accepted) {
            message.success("已保存并派发到执行环境");
          } else {
            message.warning("已保存，但当前没有可用执行环境，未派发");
          }
          closeWorkspaceRequirementCreateModal();
          return;
        }

        if (!requirementId) return;
        const saved = await updateWorkspaceRequirement(requirementId, (row) => ({
          ...row,
          title,
          bodyMarkdown: materialized.bodyMarkdown,
          imagePaths: materialized.imagePaths,
          repositoryId,
          // 保存并派发视为重新执行：已完结/待验证的需求回到 open，会话完成后会再次标记待验证。
          ...(dispatchAfterSave && row.status !== "open" ? { status: "open" } : {}),
          updatedAt: now,
        }));
        if (!dispatchAfterSave) {
          message.success("需求已更新");
          closeWorkspaceRequirementEditModal();
          return;
        }
        const savedItem = saved.items.find((row) => row.id === requirementId);
        if (!savedItem) {
          message.error("保存成功但未找到需求，请稍后在面板中重新派发");
          return;
        }
        const accepted = await dispatchSavedRequirementToEnvironment(savedItem, now);
        if (accepted) {
          message.success("已保存并派发到执行环境");
        } else {
          message.warning("已保存，但当前没有可用执行环境，未派发");
        }
        closeWorkspaceRequirementEditModal();
      } catch (err) {
        console.error("[WorkspaceRequirements] modal save failed", err);
        message.error(err instanceof Error ? err.message : "保存需求失败");
      } finally {
        setSaving(false);
      }
    },
    [mode, repositories, repositoryId, requirementId],
  );

  const draftImageCount = countMarkdownImages(draftBody);
  const isEdit = mode === "edit";

  return (
    <Modal
      title={isEdit ? "编辑需求" : "新增需求"}
      open={open}
      onOk={() => void handleSave(false)}
      onCancel={handleClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: loadingItem }}
      footer={
        (_, { OkBtn, CancelBtn }) => (
          <Space>
            <CancelBtn />
            <Button loading={saving} disabled={loadingItem} onClick={() => void handleSave(true)}>
              保存并派发
            </Button>
            <OkBtn />
          </Space>
        )
      }
      destroyOnHidden
      width={760}
      centered
      zIndex={10000}
      getContainer={() => document.body}
      mask={{ closable: false }}
      keyboard
      className="app-workspace-requirements-edit-modal"
      rootClassName="app-workspace-requirements-edit-modal-root"
    >
      <div className="app-workspace-requirements-panel__create-repo">
        <Typography.Text className="app-workspace-requirements-panel__create-repo-label">
          归属仓库
        </Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={repositories.length === 0 ? "暂无可用仓库" : "选择仓库"}
          disabled={repositories.length === 0 || saving || loadingItem}
          value={repositoryId ?? undefined}
          options={repositoryOptions}
          onChange={(value: string) => setRepositoryId(value)}
          style={{ width: "100%" }}
          aria-label="归属仓库"
          status={
            isEdit &&
            repositoryId &&
            repositories.some((repo) => String(repo.id) === repositoryId)
              ? undefined
              : isEdit
                ? "warning"
                : undefined
          }
        />
      </div>
      <Typography.Paragraph type="secondary" className="app-workspace-requirements-panel__edit-hint">
        支持从剪贴板复制粘贴或拖入图片；选中图片后拖动右下角控制点即可缩放大小。
        保存后图片会落到本地 `~/.wise/composer-images/`，派发时以
        `@当前执行环境` + 文字 + 本地路径开 worker，不占主会话。
        {draftImageCount > 0 ? ` 当前草稿含 ${draftImageCount} 张图。` : null}
      </Typography.Paragraph>
      <ErrorBoundary type="local" fallbackTitle="需求编辑器加载失败">
        <Suspense
          fallback={
            <div className="app-file-editor-loading">
              <Spin size="small" />
            </div>
          }
        >
          {open && (!isEdit || !loadingItem) ? (
            <RequirementRichTextEditor
              editorKey={editorKey}
              initialBody={draftBody}
              mentionSuggestions={mentionSuggestions}
              onChange={(md) => {
                draftBodyRef.current = md;
                setDraftBody(md);
              }}
            />
          ) : (
            <div className="app-file-editor-loading">
              <Spin size="small" />
            </div>
          )}
        </Suspense>
      </ErrorBoundary>
    </Modal>
  );
}
