import { Modal, Select, Spin, Typography, message } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  countMarkdownImages,
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import {
  appendWorkspaceRequirement,
} from "../../services/workspaceRequirementsStore";
import {
  closeWorkspaceRequirementCreateModal,
  useWorkspaceRequirementCreateModalDefaultRepositoryId,
  useWorkspaceRequirementCreateModalEpoch,
  useWorkspaceRequirementCreateModalOpen,
} from "../../stores/workspaceMemoPanelStore";
import type { Repository } from "../../types";
import {
  createWorkspaceRequirementItem,
  deriveRequirementTitle,
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

export type WorkspaceRequirementCreateModalProps = {
  repositories: Repository[];
  activeRepositoryId: number | null;
};

/**
 * 全局「新增需求」弹窗：始终可挂载，不依赖需求 tab 打开。
 * 必须指定归属仓库；默认取打开弹窗时传入 / 当前选中仓库。
 */
export function WorkspaceRequirementCreateModal({
  repositories,
  activeRepositoryId,
}: WorkspaceRequirementCreateModalProps) {
  const open = useWorkspaceRequirementCreateModalOpen();
  const editorKey = useWorkspaceRequirementCreateModalEpoch();
  const preferredRepositoryId = useWorkspaceRequirementCreateModalDefaultRepositoryId();
  const [draftBody, setDraftBody] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftBodyRef = useRef("");
  const editorRef = useRef<MilkdownEditorHandle | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftBody("");
    draftBodyRef.current = "";
    setRepositoryId(resolveDefaultRepositoryId(preferredRepositoryId, activeRepositoryId, repositories));
  }, [open, editorKey, preferredRepositoryId, activeRepositoryId, repositories]);

  const repositoryOptions = useMemo(
    () =>
      repositories.map((repo) => ({
        value: String(repo.id),
        label: repositoryFolderBasename(repo),
      })),
    [repositories],
  );

  const handleClose = useCallback(() => {
    closeWorkspaceRequirementCreateModal();
  }, []);

  const handleSave = useCallback(async () => {
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
      const created = createWorkspaceRequirementItem(materialized.bodyMarkdown, now, repositoryId);
      created.title = title;
      created.imagePaths = materialized.imagePaths;
      await appendWorkspaceRequirement(created);
      message.success("需求已新增");
      closeWorkspaceRequirementCreateModal();
    } catch (err) {
      console.error("[WorkspaceRequirements] create modal save failed", err);
      message.error(err instanceof Error ? err.message : "保存需求失败");
    } finally {
      setSaving(false);
    }
  }, [repositories, repositoryId]);

  const draftImageCount = countMarkdownImages(draftBody);

  return (
    <Modal
      title="新增需求"
      open={open}
      onOk={() => void handleSave()}
      onCancel={handleClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
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
          disabled={repositories.length === 0 || saving}
          value={repositoryId ?? undefined}
          options={repositoryOptions}
          onChange={(value: string) => setRepositoryId(value)}
          style={{ width: "100%" }}
          aria-label="归属仓库"
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
          {open ? (
            <RequirementMilkdownEditor
              editorRef={editorRef}
              editorKey={editorKey}
              initialBody={draftBody}
              onChange={(md) => {
                draftBodyRef.current = md;
                setDraftBody(md);
              }}
            />
          ) : null}
        </Suspense>
      </ErrorBoundary>
    </Modal>
  );
}
