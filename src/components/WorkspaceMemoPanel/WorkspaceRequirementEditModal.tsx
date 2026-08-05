import { Modal, Select, Spin, Typography, message } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { readComposerImageAsDataUrl } from "../../services/readComposerImage";
import {
  countMarkdownImages,
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import {
  loadWorkspaceRequirements,
  updateWorkspaceRequirement,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
} from "../../services/workspaceRequirementsStore";
import {
  closeWorkspaceRequirementEditModal,
  useWorkspaceRequirementEditModalEpoch,
  useWorkspaceRequirementEditModalOpen,
  useWorkspaceRequirementEditModalRequirementId,
} from "../../stores/workspaceMemoPanelStore";
import type { Repository } from "../../types";
import {
  deriveRequirementTitle,
  type WorkspaceRequirementsPayloadV1,
} from "../../types/workspaceRequirements";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { ErrorBoundary } from "../ErrorBoundary";
import type { MilkdownEditorHandle } from "../MilkdownViewer";
import { MilkdownSyntaxToolbar } from "../MilkdownViewer/MilkdownSyntaxToolbar";
import "./index.css";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

function RequirementMilkdownEditor({
  editorRef,
  editorKey,
  initialBody,
  onChange,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  editorKey: number;
  initialBody: string;
  onChange: (markdown: string) => void;
}) {
  return (
    <div className="app-workspace-requirements-panel__editor-wrap">
      <MilkdownSyntaxToolbar editorRef={editorRef} />
      <MilkdownEditor
        ref={editorRef}
        key={editorKey}
        text={initialBody}
        onChange={onChange}
        floatingToolbar
        blockEdit={false}
      />
    </div>
  );
}

async function hydrateMarkdownImagesForEditor(markdown: string): Promise<string> {
  let next = markdown;
  const paths = [...markdown.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)\)/g)].map((m) => m[1]!.trim());
  for (const path of paths) {
    if (!path.startsWith("/")) continue;
    const dataUrl = await readComposerImageAsDataUrl(path);
    if (!dataUrl) continue;
    next = next.split(`](${path})`).join(`](${dataUrl})`);
  }
  return next;
}

export type WorkspaceRequirementEditModalProps = {
  repositories: Repository[];
};

/**
 * 全局「编辑需求」弹窗：不打开 / 不切换中栏需求 tab。
 */
export function WorkspaceRequirementEditModal({ repositories }: WorkspaceRequirementEditModalProps) {
  const open = useWorkspaceRequirementEditModalOpen();
  const editorKey = useWorkspaceRequirementEditModalEpoch();
  const requirementId = useWorkspaceRequirementEditModalRequirementId();
  const [draftBody, setDraftBody] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftBodyRef = useRef("");
  const editorRef = useRef<MilkdownEditorHandle | null>(null);
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (!open || !requirementId) return;
    const gen = ++loadGenRef.current;
    setLoadingItem(true);
    setDraftBody("");
    draftBodyRef.current = "";
    setRepositoryId(null);

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
  }, [open, editorKey, requirementId]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, requirementId]);

  const repositoryOptions = useMemo(() => {
    const options = repositories.map((repo) => ({
      value: String(repo.id),
      label: repositoryFolderBasename(repo),
    }));
    if (repositoryId && !options.some((option) => option.value === repositoryId)) {
      options.unshift({
        value: repositoryId,
        label: `未知仓库 (${repositoryId})`,
      });
    }
    return options;
  }, [repositories, repositoryId]);

  const handleClose = useCallback(() => {
    closeWorkspaceRequirementEditModal();
  }, []);

  const handleSave = useCallback(async () => {
    if (!requirementId) return;
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
      await updateWorkspaceRequirement(requirementId, (row) => ({
        ...row,
        title,
        bodyMarkdown: materialized.bodyMarkdown,
        imagePaths: materialized.imagePaths,
        repositoryId,
        updatedAt: now,
      }));
      message.success("需求已更新");
      closeWorkspaceRequirementEditModal();
    } catch (err) {
      console.error("[WorkspaceRequirements] edit modal save failed", err);
      message.error(err instanceof Error ? err.message : "保存需求失败");
    } finally {
      setSaving(false);
    }
  }, [repositories, repositoryId, requirementId]);

  const draftImageCount = countMarkdownImages(draftBody);

  return (
    <Modal
      title="编辑需求"
      open={open}
      onOk={() => void handleSave()}
      onCancel={handleClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: loadingItem }}
      destroyOnHidden
      width={720}
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
            repositoryId && repositories.some((repo) => String(repo.id) === repositoryId)
              ? undefined
              : "warning"
          }
        />
      </div>
      <Typography.Paragraph type="secondary" className="app-workspace-requirements-panel__edit-hint">
        支持粘贴 / 拖入图片。保存后图片会落到本地 `~/.wise/composer-images/`，派发时以
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
          {open && !loadingItem ? (
            <RequirementMilkdownEditor
              editorRef={editorRef}
              editorKey={editorKey}
              initialBody={draftBody}
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
