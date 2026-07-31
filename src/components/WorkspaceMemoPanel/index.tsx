import {
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Empty, Modal, Spin, Tag, Typography, message } from "antd";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { dispatchRequirementToExecutionEnvironment } from "../../constants/pendingTaskQueueEvents";
import {
  buildRequirementDispatchPayload,
  countMarkdownImages,
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import { readComposerImageAsDataUrl } from "../../services/readComposerImage";
import {
  loadWorkspaceRequirements,
  saveWorkspaceRequirements,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
} from "../../services/workspaceRequirementsStore";
import {
  closeWorkspaceMemoPanel,
  requestWorkspaceRequirementCreate,
} from "../../stores/workspaceMemoPanelStore";
import { ErrorBoundary } from "../ErrorBoundary";
import type { MilkdownEditorHandle } from "../MilkdownViewer";
import { MilkdownSyntaxToolbar } from "../MilkdownViewer/MilkdownSyntaxToolbar";
import {
  createWorkspaceRequirementItem,
  deriveRequirementTitle,
  type WorkspaceRequirementItem,
  type WorkspaceRequirementsPayloadV1,
} from "../../types/workspaceRequirements";
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

function previewText(item: WorkspaceRequirementItem): string {
  const body = stripMarkdownImages(item.bodyMarkdown || item.description || "");
  if (!body || body === item.title) return "";
  return body.replace(/\s+/g, " ").trim();
}

function thumbSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

interface RequirementRowProps {
  item: WorkspaceRequirementItem;
  dispatchingId: string | null;
  onToggleDone: (item: WorkspaceRequirementItem) => void;
  onEdit: (item: WorkspaceRequirementItem) => void;
  onDelete: (item: WorkspaceRequirementItem) => void;
  onDispatch: (item: WorkspaceRequirementItem) => void;
}

function requirementRowEqual(prev: RequirementRowProps, next: RequirementRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.dispatchingId === next.dispatchingId &&
    prev.onToggleDone === next.onToggleDone &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onDispatch === next.onDispatch
  );
}

const RequirementRow = memo(function RequirementRow({
  item,
  dispatchingId,
  onToggleDone,
  onEdit,
  onDelete,
  onDispatch,
}: RequirementRowProps) {
  const done = item.status === "done";
  const dispatching = dispatchingId === item.id;
  const thumbs = item.imagePaths.slice(0, 3);
  const moreImages = Math.max(0, item.imagePaths.length - thumbs.length);
  const desc = previewText(item);

  return (
    <li
      className={`app-workspace-requirements-panel__row${done ? " app-workspace-requirements-panel__row--done" : ""}`}
    >
      <Checkbox
        className="app-workspace-requirements-panel__check"
        checked={done}
        onChange={() => onToggleDone(item)}
        aria-label={done ? "标记为未完成" : "标记为已完成"}
      />
      <div className="app-workspace-requirements-panel__row-main">
        <div className="app-workspace-requirements-panel__title-line">
          <span className="app-workspace-requirements-panel__title">{item.title}</span>
          {item.imagePaths.length > 0 ? (
            <Tag icon={<PictureOutlined />} className="app-workspace-requirements-panel__tag">
              {item.imagePaths.length}
            </Tag>
          ) : null}
          {item.lastDispatchedAt != null ? (
            <Tag className="app-workspace-requirements-panel__tag">已派发</Tag>
          ) : null}
        </div>
        {desc ? (
          <Typography.Paragraph
            className="app-workspace-requirements-panel__desc"
            type="secondary"
            ellipsis={{ rows: 1, expandable: false }}
          >
            {desc}
          </Typography.Paragraph>
        ) : null}
        {thumbs.length > 0 ? (
          <div className="app-workspace-requirements-panel__thumbs">
            {thumbs.map((path) => (
              <img key={path} src={thumbSrc(path)} alt="" className="app-workspace-requirements-panel__thumb" />
            ))}
            {moreImages > 0 ? (
              <span className="app-workspace-requirements-panel__thumb-more">+{moreImages}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="app-workspace-requirements-panel__row-actions">
        {!done ? (
          <Button
            type="text"
            size="small"
            icon={<SendOutlined />}
            loading={dispatching}
            aria-label="派发执行"
            title="派发到当前执行环境（不占主会话）"
            onClick={() => onDispatch(item)}
          />
        ) : null}
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          aria-label="编辑需求"
          title="编辑"
          onClick={() => onEdit(item)}
        />
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label="删除需求"
          title="删除"
          onClick={() => onDelete(item)}
        />
      </div>
    </li>
  );
}, requirementRowEqual);

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

/**
 * 中栏需求管理：图文 Markdown 编辑；派发时落盘本地图片并以「文字 + @路径」入队。
 */
export function WorkspaceMemoPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WorkspaceRequirementItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const draftBodyRef = useRef("");
  const editorRef = useRef<MilkdownEditorHandle | null>(null);
  const editorOpenRef = useRef(editorOpen);
  editorOpenRef.current = editorOpen;

  const persist = useCallback(async (next: WorkspaceRequirementItem[]) => {
    setSaving(true);
    try {
      const saved = await saveWorkspaceRequirements(next);
      if (mountedRef.current) {
        setItems(saved.items);
      }
    } catch (err) {
      console.error("[WorkspaceRequirements] save failed", err);
      message.error(err instanceof Error ? err.message : "保存需求失败");
      throw err;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setLoading(true);
    void loadWorkspaceRequirements()
      .then((payload) => {
        if (cancelled) return;
        setItems(payload.items);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[WorkspaceRequirements] load failed", err);
        message.error("加载需求失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  // 全局新增弹窗保存后同步列表（不依赖本面板是否打开过 create）。
  useEffect(() => {
    function onRequirementsChanged(event: Event) {
      const detail = (event as CustomEvent<WorkspaceRequirementsPayloadV1>).detail;
      if (!detail || !Array.isArray(detail.items)) return;
      if (!mountedRef.current) return;
      setItems(detail.items);
    }
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);
    return () => {
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);
    };
  }, []);

  const openCreate = useCallback(() => {
    requestWorkspaceRequirementCreate();
  }, []);

  const openEdit = useCallback((item: WorkspaceRequirementItem) => {
    const body = item.bodyMarkdown || item.description || item.title;
    setEditingId(item.id);
    setDraftBody(body);
    draftBodyRef.current = body;
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
    void hydrateMarkdownImagesForEditor(body).then((hydrated) => {
      if (!mountedRef.current) return;
      if (draftBodyRef.current !== body) return;
      setDraftBody(hydrated);
      draftBodyRef.current = hydrated;
      setEditorKey((k) => k + 1);
    });
  }, []);

  const saveEditor = useCallback(async () => {
    const rawBody = draftBodyRef.current.trim();
    if (!rawBody) {
      message.warning("请填写需求图文内容（可粘贴/拖入图片）");
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
      let next: WorkspaceRequirementItem[];
      if (editingId) {
        next = itemsRef.current.map((row) =>
          row.id === editingId
            ? {
                ...row,
                title,
                bodyMarkdown: materialized.bodyMarkdown,
                imagePaths: materialized.imagePaths,
                updatedAt: now,
              }
            : row,
        );
      } else {
        const created = createWorkspaceRequirementItem(materialized.bodyMarkdown, now);
        created.title = title;
        created.imagePaths = materialized.imagePaths;
        next = [...itemsRef.current, created];
      }
      await persist(next);
      setEditorOpen(false);
      setEditingId(null);
    } catch (err) {
      console.error("[WorkspaceRequirements] editor save failed", err);
      message.error(err instanceof Error ? err.message : "保存需求失败");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [editingId, persist]);

  const handleToggleDone = useCallback(
    async (item: WorkspaceRequirementItem) => {
      const next = itemsRef.current.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: (row.status === "done" ? "open" : "done") as WorkspaceRequirementItem["status"],
              updatedAt: Date.now(),
            }
          : row,
      );
      await persist(next);
    },
    [persist],
  );

  const handleDelete = useCallback(
    (item: WorkspaceRequirementItem) => {
      Modal.confirm({
        title: "删除该需求？",
        content: item.title,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        autoFocusButton: "cancel",
        onOk: async () => {
          await persist(itemsRef.current.filter((row) => row.id !== item.id));
        },
      });
    },
    [persist],
  );

  const handleDispatch = useCallback(
    async (item: WorkspaceRequirementItem) => {
      setDispatchingId(item.id);
      try {
        const payload = await buildRequirementDispatchPayload(item);
        const accepted = dispatchRequirementToExecutionEnvironment({
          promptText: payload.promptText,
          userBubblePrompt: payload.executeBubbleOptions?.userBubblePrompt ?? payload.promptText,
          source: "workspace-requirement",
        });
        if (!accepted) {
          message.warning("当前没有可用主会话，无法派发到执行环境");
          return;
        }
        const now = Date.now();
        const next = itemsRef.current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                bodyMarkdown: row.bodyMarkdown || item.bodyMarkdown,
                imagePaths: payload.imagePaths.length > 0 ? payload.imagePaths : row.imagePaths,
                lastDispatchedAt: now,
                updatedAt: now,
              }
            : row,
        );
        await persist(next);
      } catch (err) {
        console.error("[WorkspaceRequirements] dispatch failed", err);
        message.error(err instanceof Error ? err.message : "派发失败");
      } finally {
        if (mountedRef.current) setDispatchingId(null);
      }
    },
    [persist],
  );

  const handleClose = useCallback(() => {
    closeWorkspaceMemoPanel();
  }, []);

  // ⌘W / Ctrl+W：关闭需求面板。新增走 AppImpl 全局 ⌘A（仅弹窗，不切 tab）。
  useEffect(() => {
    function handleCloseShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") return;
      if (editorOpenRef.current) return;

      const target = event.target;
      if (target instanceof Element && target.closest(".terminal-panel")) return;

      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
    window.addEventListener("keydown", handleCloseShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleCloseShortcut, { capture: true });
  }, [handleClose]);

  const openItems = items.filter((item) => item.status === "open");
  const doneItems = items.filter((item) => item.status === "done");
  const draftImageCount = countMarkdownImages(draftBody);
  const isMacShortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
  const closeShortcutLabel = isMacShortcut ? "⌘W" : "Ctrl+W";
  const createShortcutLabel = isMacShortcut ? "⌘A" : "Ctrl+A";

  return (
    <div
      className="app-file-editor-panel app-workspace-memo-panel app-workspace-requirements-panel"
      aria-label="需求管理"
    >
      <div className="app-file-editor-header">
        <div className="app-file-editor-tab-bar">
          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="需求管理">
            <div
              role="tab"
              aria-selected
              className="app-file-editor-tab app-file-editor-tab--active"
            >
              <span className="app-file-editor-tab-label">需求</span>
            </div>
          </div>
          <div className="app-file-editor-tab-bar-actions">
            <span className="app-workspace-memo-panel__save-status">
              {saving ? "保存中…" : `${openItems.length} 项待办`}
            </span>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={openCreate}
              title={`新增需求（${createShortcutLabel}）`}
              aria-label={`新增需求（${createShortcutLabel}）`}
            >
              新增
            </Button>
            <Button
              type="text"
              size="small"
              onClick={handleClose}
              title={`关闭（${closeShortcutLabel}）`}
              aria-label={`关闭需求（${closeShortcutLabel}）`}
            >
              关闭
            </Button>
          </div>
        </div>
      </div>
      <div className="app-file-editor-body app-workspace-memo-panel__body">
        {loading ? (
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        ) : (
          <div className="app-workspace-requirements-panel__content">
            {items.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无需求，点击「新增」或按 ${createShortcutLabel} 编写图文需求后再派发`}
              >
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                  title={`新增需求（${createShortcutLabel}）`}
                  aria-label={`新增需求（${createShortcutLabel}）`}
                >
                  新增需求
                </Button>
              </Empty>
            ) : (
              <ul className="app-workspace-requirements-panel__list">
                {openItems.map((item) => (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    dispatchingId={dispatchingId}
                    onToggleDone={(row) => void handleToggleDone(row)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onDispatch={(row) => void handleDispatch(row)}
                  />
                ))}
                {doneItems.length > 0 ? (
                  <li className="app-workspace-requirements-panel__section-label">已完成</li>
                ) : null}
                {doneItems.map((item) => (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    dispatchingId={dispatchingId}
                    onToggleDone={(row) => void handleToggleDone(row)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onDispatch={(row) => void handleDispatch(row)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Modal
        title="编辑需求"
        open={editorOpen && editingId != null}
        onOk={() => void saveEditor()}
        onCancel={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
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
            <RequirementMilkdownEditor
              editorRef={editorRef}
              editorKey={editorKey}
              initialBody={draftBody}
              onChange={(md) => {
                draftBodyRef.current = md;
                setDraftBody(md);
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </Modal>
    </div>
  );
}

/** Host 包装：稳定节点 identity 不变，HMR 时仍渲染最新 WorkspaceMemoPanel。 */
function WorkspaceMemoPanelHost() {
  return <WorkspaceMemoPanel />;
}

/** 稳定节点：写入 `panelBelowMessages` 时 identity 不随 layout 重渲变化。 */
export const WORKSPACE_MEMO_PANEL_NODE = <WorkspaceMemoPanelHost />;
