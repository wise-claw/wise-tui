import {
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  SendOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Empty,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Tag,
  message,
} from "antd";
import { convertFileSrc } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import { dispatchRequirementToExecutionEnvironment } from "../../constants/pendingTaskQueueEvents";
import { useWorkspaceRequirementAutoDispatchSetting } from "../../hooks/useWorkspaceRequirementAutoDispatch";
import {
  buildRequirementDispatchPayload,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import {
  loadWorkspaceRequirements,
  saveWorkspaceRequirements,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
  WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN,
} from "../../services/workspaceRequirementsStore";
import {
  closeWorkspaceMemoPanel,
  requestWorkspaceRequirementCreate,
  requestWorkspaceRequirementEdit,
  useWorkspaceMemoPanelSelectedRequirementId,
} from "../../stores/workspaceMemoPanelStore";
import {
  matchesWorkspaceRequirementStatusFilter,
  WORKSPACE_REQUIREMENT_STATUS_FILTER_OPTIONS,
  type WorkspaceRequirementStatusFilter,
} from "../../constants/workspaceRequirementStatusFilter";
import { loadRepositories } from "../../services/repository";
import type { Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import type { WorkspaceRequirementItem, WorkspaceRequirementsPayloadV1 } from "../../types/workspaceRequirements";
import { MarkdownBody } from "../ClaudeSessions/MarkdownElements";
import "./index.css";

function markdownPreview(item: WorkspaceRequirementItem): string {
  const body = stripMarkdownImages(item.bodyMarkdown || item.description || "");
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat || flat === item.title) return "";
  return body;
}

function thumbSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

/** 右栏详情将需求落盘后的绝对图片路径转换为 WebView 可加载地址。 */
function hydrateRequirementImageSources(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, (_match, alt, path) =>
      `![${String(alt ?? "")}](${thumbSrc(String(path ?? ""))})`,
    )
    .replace(/(<img\b[^>]*?\bsrc=")(\/[^"]+)(")/gi, (_match, prefix, path, suffix) =>
      `${String(prefix)}${thumbSrc(String(path ?? ""))}${String(suffix)}`,
    );
}

const allowRequirementImageUrl: UrlTransform = (url) => {
  if (url.startsWith("asset:") || /^https?:\/\/asset\./i.test(url) || url.startsWith("data:")) {
    return url;
  }
  return defaultUrlTransform(url);
};

interface RequirementRowProps {
  item: WorkspaceRequirementItem;
  repositoryLabel: string;
  repositoryMissing: boolean;
  dispatchingId: string | null;
  selected: boolean;
  onToggleDone: (item: WorkspaceRequirementItem) => void;
  onEdit: (item: WorkspaceRequirementItem) => void;
  onDelete: (item: WorkspaceRequirementItem) => void;
  onDispatch: (item: WorkspaceRequirementItem) => void;
}

function requirementRowEqual(prev: RequirementRowProps, next: RequirementRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.repositoryLabel === next.repositoryLabel &&
    prev.repositoryMissing === next.repositoryMissing &&
    prev.dispatchingId === next.dispatchingId &&
    prev.selected === next.selected &&
    prev.onToggleDone === next.onToggleDone &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onDispatch === next.onDispatch
  );
}

const RequirementRow = memo(function RequirementRow({
  item,
  repositoryLabel,
  repositoryMissing,
  dispatchingId,
  selected,
  onToggleDone,
  onEdit,
  onDelete,
  onDispatch,
}: RequirementRowProps) {
  const done = item.status === "done";
  const dispatching = dispatchingId === item.id;
  const thumbs = item.imagePaths.slice(0, 3);
  const moreImages = Math.max(0, item.imagePaths.length - thumbs.length);
  const desc = markdownPreview(item);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const detailMarkdown = useMemo(
    () => hydrateRequirementImageSources(item.bodyMarkdown || item.description || item.title),
    [item.bodyMarkdown, item.description, item.title],
  );

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  return (
    <li
      ref={rowRef}
      className={`app-workspace-requirements-panel__row${done ? " app-workspace-requirements-panel__row--done" : ""}${selected ? " app-workspace-requirements-panel__row--selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <Checkbox
        className="app-workspace-requirements-panel__check"
        checked={done}
        onChange={() => onToggleDone(item)}
        aria-label={done ? "标记为未完成" : "标记为已完成"}
      />
      <div className="app-workspace-requirements-panel__row-main">
        <div className="app-workspace-requirements-panel__title-line">
          {repositoryMissing ? (
            <Tag
              icon={<WarningOutlined />}
              color="warning"
              className="app-workspace-requirements-panel__tag"
              title={repositoryLabel}
            >
              {repositoryLabel}
            </Tag>
          ) : null}
          <span className="app-workspace-requirements-panel__title">{item.title}</span>
          {!repositoryMissing ? (
            <Tag className="app-workspace-requirements-panel__tag">{repositoryLabel}</Tag>
          ) : null}
          {item.imagePaths.length > 0 ? (
            <Tag icon={<PictureOutlined />} className="app-workspace-requirements-panel__tag">
              {item.imagePaths.length}
            </Tag>
          ) : null}
          {done ? (
            <Tag color="success" className="app-workspace-requirements-panel__tag">
              已验证
            </Tag>
          ) : null}
          {item.lastDispatchedAt != null ? (
            <Tag className="app-workspace-requirements-panel__tag">已派发</Tag>
          ) : null}
          {item.status === "verifying" ? (
            <Tag color="warning" className="app-workspace-requirements-panel__tag">
              待验证
            </Tag>
          ) : null}
        </div>
        {selected ? (
          <div className="app-workspace-requirements-panel__detail app-markdown">
            <MarkdownBody
              source={detailMarkdown}
              rehypePlugins={[rehypeRaw]}
              urlTransform={allowRequirementImageUrl}
            />
          </div>
        ) : desc ? (
          <div className="app-workspace-requirements-panel__md-desc app-markdown">
            <MarkdownBody source={desc} />
          </div>
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

/**
 * 中栏需求管理：列表、完成态、派发；新增/编辑走全局独立弹窗，不依赖本面板。
 */
export function WorkspaceMemoPanel() {
  const selectedRequirementId = useWorkspaceMemoPanelSelectedRequirementId();
  const [statusFilter, setStatusFilter] = useState<WorkspaceRequirementStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WorkspaceRequirementItem[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [saving, setSaving] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const {
    enabled: autoDispatch,
    setEnabled: setAutoDispatch,
    concurrency: autoDispatchConcurrency,
    setConcurrency: setAutoDispatchConcurrency,
  } =
    useWorkspaceRequirementAutoDispatchSetting();
  const mountedRef = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
    void Promise.all([loadWorkspaceRequirements(), loadRepositories()])
      .then(([payload, repos]) => {
        if (cancelled) return;
        setItems(payload.items);
        setRepositories(repos);
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

  const resolveRepositoryMeta = useCallback(
    (repositoryId: string | null): { label: string; missing: boolean } => {
      if (!repositoryId) return { label: "未指定仓库", missing: true };
      const repo = repositories.find((item) => String(item.id) === repositoryId);
      if (!repo) return { label: "未知仓库", missing: true };
      return { label: repositoryFolderBasename(repo), missing: false };
    },
    [repositories],
  );

  // 全局新增/编辑弹窗保存后同步列表。
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

  // 左栏点选的需求优先可见：仅在右栏当前筛选会把目标隐藏时，调整右栏自己的筛选。
  useEffect(() => {
    if (!selectedRequirementId || statusFilter === "all") return;
    const selected = items.find((item) => item.id === selectedRequirementId);
    if (selected && selected.status !== statusFilter) {
      setStatusFilter(selected.status);
    }
  }, [items, selectedRequirementId, statusFilter]);

  const openCreate = useCallback(() => {
    requestWorkspaceRequirementCreate();
  }, []);

  const openEdit = useCallback((item: WorkspaceRequirementItem) => {
    requestWorkspaceRequirementEdit(item.id);
  }, []);

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
          requirementId: item.id,
          requirementRepositoryId: item.repositoryId,
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
                dispatchAttemptCount: (row.dispatchAttemptCount ?? 0) + 1,
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

  // ⌘W / Ctrl+W：关闭需求面板。新增/编辑走全局独立弹窗（不切 tab）。
  useEffect(() => {
    function handleCloseShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") return;

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
  const verifyingItems = items.filter((item) => item.status === "verifying");
  const doneItems = items.filter((item) => item.status === "done");
  const filteredOpenItems = openItems.filter((item) =>
    matchesWorkspaceRequirementStatusFilter(item, statusFilter),
  );
  const filteredVerifyingItems = verifyingItems.filter((item) =>
    matchesWorkspaceRequirementStatusFilter(item, statusFilter),
  );
  const filteredDoneItems = doneItems.filter((item) =>
    matchesWorkspaceRequirementStatusFilter(item, statusFilter),
  );
  const filteredItemCount =
    filteredOpenItems.length + filteredVerifyingItems.length + filteredDoneItems.length;
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
            <Select<WorkspaceRequirementStatusFilter>
              size="small"
              value={statusFilter}
              options={WORKSPACE_REQUIREMENT_STATUS_FILTER_OPTIONS}
              onChange={setStatusFilter}
              className="app-workspace-requirements-panel__status-filter"
              aria-label="按需求状态过滤"
              popupMatchSelectWidth={96}
              getPopupContainer={() => document.body}
            />
            <span className="app-workspace-memo-panel__save-status">
              {saving ? "保存中…" : `${openItems.length + verifyingItems.length} 项待办`}
            </span>
            <span
              className="app-workspace-memo-panel__auto-dispatch"
              title={
                autoDispatch
                  ? `自动派发已开启：新增/编辑的待办需求会自动派发到当前执行环境；并发上限 ${autoDispatchConcurrency}（按当前运行会话数动态派发）`
                  : "开启后新增/编辑的待办需求会自动派发到当前执行环境"
              }
            >
              <Switch
                size="small"
                checked={autoDispatch}
                onChange={(checked) => void setAutoDispatch(checked)}
                aria-label="自动派发"
              />
              <span>自动派发</span>
              <InputNumber
                size="small"
                min={WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN}
                value={autoDispatchConcurrency}
                onChange={(value) => {
                  if (value != null) void setAutoDispatchConcurrency(value);
                }}
                className="app-workspace-memo-panel__auto-dispatch-concurrency"
                aria-label="自动派发并发数"
              />
              <span>并发</span>
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
            {filteredItemCount === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  items.length === 0
                    ? `暂无需求，点击「新增」或按 ${createShortcutLabel} 编写图文需求后再派发`
                    : "当前状态下暂无需求"
                }
              >
                <Button
                  type="primary"
                  icon={items.length === 0 ? <PlusOutlined /> : undefined}
                  onClick={
                    items.length === 0
                      ? openCreate
                      : () => setStatusFilter("all")
                  }
                  title={items.length === 0 ? `新增需求（${createShortcutLabel}）` : "查看全部需求"}
                  aria-label={items.length === 0 ? `新增需求（${createShortcutLabel}）` : "查看全部需求"}
                >
                  {items.length === 0 ? "新增需求" : "查看全部"}
                </Button>
              </Empty>
            ) : (
              <ul className="app-workspace-requirements-panel__list">
                {filteredVerifyingItems.length > 0 ? (
                  <li className="app-workspace-requirements-panel__section-label">待验证</li>
                ) : null}
                {filteredVerifyingItems.map((item) => {
                  const repo = resolveRepositoryMeta(item.repositoryId);
                  return (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    repositoryLabel={repo.label}
                    repositoryMissing={repo.missing}
                    dispatchingId={dispatchingId}
                    selected={item.id === selectedRequirementId}
                    onToggleDone={(row) => void handleToggleDone(row)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onDispatch={(row) => void handleDispatch(row)}
                  />
                  );
                })}
                {filteredOpenItems.map((item) => {
                  const repo = resolveRepositoryMeta(item.repositoryId);
                  return (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    repositoryLabel={repo.label}
                    repositoryMissing={repo.missing}
                    dispatchingId={dispatchingId}
                    selected={item.id === selectedRequirementId}
                    onToggleDone={(row) => void handleToggleDone(row)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onDispatch={(row) => void handleDispatch(row)}
                  />
                  );
                })}
                {filteredDoneItems.length > 0 ? (
                  <li className="app-workspace-requirements-panel__section-label">已完成</li>
                ) : null}
                {filteredDoneItems.map((item) => {
                  const repo = resolveRepositoryMeta(item.repositoryId);
                  return (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    repositoryLabel={repo.label}
                    repositoryMissing={repo.missing}
                    dispatchingId={dispatchingId}
                    selected={item.id === selectedRequirementId}
                    onToggleDone={(row) => void handleToggleDone(row)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onDispatch={(row) => void handleDispatch(row)}
                  />
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Host 包装：稳定节点 identity 不变，HMR 时仍渲染最新 WorkspaceMemoPanel。 */
function WorkspaceMemoPanelHost() {
  return <WorkspaceMemoPanel />;
}

/** 稳定节点：写入 `panelBelowMessages` 时 identity 不随 layout 重渲变化。 */
export const WORKSPACE_MEMO_PANEL_NODE = <WorkspaceMemoPanelHost />;
