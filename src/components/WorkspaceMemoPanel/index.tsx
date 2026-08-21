import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LeftOutlined,
  MessageOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
  SendOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  Button,
  Dropdown,
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
  openWorkspaceRequirementExecutionSession,
  resumeWorkspaceRequirementExecutionSession,
  useWorkspaceMemoPanelSelectedRequirementId,
} from "../../stores/workspaceMemoPanelStore";
import {
  matchesWorkspaceRequirementStatusFilter,
  WORKSPACE_REQUIREMENT_STATUS_FILTER_OPTIONS,
  type WorkspaceRequirementStatusFilter,
} from "../../constants/workspaceRequirementStatusFilter";
import type { WorkspaceRequirementItem, WorkspaceRequirementsPayloadV1 } from "../../types/workspaceRequirements";
import { MarkdownBody } from "../ClaudeSessions/MarkdownElements";
import { MonitorDrawerSessionComposer } from "../ProgressMonitorPanel/MonitorDrawerSessionComposer";
import "./index.css";

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
  dispatchingId: string | null;
  onToggleDone: (item: WorkspaceRequirementItem) => void;
  onEdit: (item: WorkspaceRequirementItem) => void;
  onReset: (item: WorkspaceRequirementItem) => void;
  onDelete: (item: WorkspaceRequirementItem) => void;
  onDispatch: (item: WorkspaceRequirementItem) => void;
  onReject: (item: WorkspaceRequirementItem) => void;
}

function requirementRowEqual(prev: RequirementRowProps, next: RequirementRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.dispatchingId === next.dispatchingId &&
    prev.onToggleDone === next.onToggleDone &&
    prev.onEdit === next.onEdit &&
    prev.onReset === next.onReset &&
    prev.onDelete === next.onDelete &&
    prev.onDispatch === next.onDispatch
    && prev.onReject === next.onReject
  );
}

const RequirementRow = memo(function RequirementRow({
  item,
  dispatchingId,
  onToggleDone,
  onEdit,
  onReset,
  onDelete,
  onDispatch,
  onReject,
}: RequirementRowProps) {
  const done = item.status === "done";
  const dispatching = dispatchingId === item.id;
  const latestExecutionSessionId =
    item.executionSessionIds[item.executionSessionIds.length - 1] ?? null;
  const thumbs = item.imagePaths.slice(0, 3);
  const moreImages = Math.max(0, item.imagePaths.length - thumbs.length);
  const detailMarkdown = useMemo(
    () => hydrateRequirementImageSources(item.bodyMarkdown || item.description || item.title),
    [item.bodyMarkdown, item.description, item.title],
  );

  return (
    <li
      className={`app-workspace-requirements-panel__row${done ? " app-workspace-requirements-panel__row--done" : ""}`}
    >
      <div className="app-workspace-requirements-panel__row-main">
        <div className="app-workspace-requirements-panel__title-line" aria-label="需求信息">
          {item.imagePaths.length > 0 ? (
            <Tag icon={<PictureOutlined />} className="app-workspace-requirements-panel__tag">
              {item.imagePaths.length}
            </Tag>
          ) : null}
        </div>
        {detailMarkdown ? (
          <div className="app-workspace-requirements-panel__detail app-markdown">
            <MarkdownBody
              source={detailMarkdown}
              rehypePlugins={[rehypeRaw]}
              urlTransform={allowRequirementImageUrl}
            />
          </div>
        ) : null}
        {thumbs.length > 0 && !/!\[[^\]]*\]\([^)]*\)|<img\b/i.test(detailMarkdown) ? (
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
        <Button
          type="text"
          size="small"
          icon={<CheckCircleOutlined />}
          className={`app-workspace-requirements-panel__complete-btn${done ? " app-workspace-requirements-panel__complete-btn--done" : ""}`}
          onClick={() => onToggleDone(item)}
          aria-label={done ? "标记为未完成" : "标记为已完成"}
          title={done ? "标记为未完成" : "标记为已完成"}
        />
        <Button
          type="text"
          size="small"
          icon={<UndoOutlined />}
          className="app-workspace-requirements-panel__reset-btn"
          onClick={() => onReset(item)}
          aria-label="退回初始态"
          title="退回初始态"
        />
        {item.status === "verifying" ? (
          <Button
            type="text"
            size="small"
            icon={<CloseCircleOutlined />}
            aria-label="验收失败"
            title="验收失败并继续执行"
            onClick={() => onReject(item)}
          />
        ) : null}
        {latestExecutionSessionId ? (
          <Button
            type="text"
            size="small"
            icon={<MessageOutlined />}
            aria-label="打开关联执行会话"
            title={
              item.executionSessionIds.length > 1
                ? `打开最近关联会话（共 ${item.executionSessionIds.length} 个）`
                : "打开关联执行会话"
            }
            onClick={() => openWorkspaceRequirementExecutionSession(latestExecutionSessionId)}
          />
        ) : null}
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
          title="编辑需求"
          onClick={() => onEdit(item)}
        />
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label="删除需求"
          title="删除需求"
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
  const [currentPage, setCurrentPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [rejectingItem, setRejectingItem] = useState<WorkspaceRequirementItem | null>(null);
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

  const resetRequirement = useCallback(
    (item: WorkspaceRequirementItem) => {
      Modal.confirm({
        title: "退回初始态？",
        content: "将恢复为待办，并清空派发记录、重试计数和关联会话。",
        okText: "退回初始态",
        cancelText: "取消",
        autoFocusButton: "cancel",
        onOk: async () => {
          const now = Date.now();
          await persist(
            itemsRef.current.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    status: "open",
                    lastDispatchedAt: null,
                    dispatchAttemptCount: 0,
                    executionSessionIds: [],
                    updatedAt: now,
                  }
                : row,
            ),
          );
        },
      });
    },
    [persist],
  );

  const resetAllRequirements = useCallback(() => {
    if (itemsRef.current.length === 0) return;
    Modal.confirm({
      title: "全部退回初始态？",
      content: `将重置全部 ${itemsRef.current.length} 条需求的状态、派发记录、重试计数和关联会话。`,
      okText: "全部退回初始态",
      cancelText: "取消",
      autoFocusButton: "cancel",
      onOk: async () => {
        const now = Date.now();
        await persist(
          itemsRef.current.map((row) => ({
            ...row,
            status: "open",
            lastDispatchedAt: null,
            dispatchAttemptCount: 0,
            executionSessionIds: [],
            updatedAt: now,
          })),
        );
        setStatusFilter("all");
        setCurrentPage(0);
      },
    });
  }, [persist]);

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

  const handleReject = useCallback((item: WorkspaceRequirementItem) => {
    setRejectingItem(item);
  }, []);

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
  const pagedItems = useMemo(() => {
    const matchesFilter = (item: WorkspaceRequirementItem) =>
      matchesWorkspaceRequirementStatusFilter(item, statusFilter);
    return [
      ...items.filter((item) => item.status === "verifying" && matchesFilter(item)),
      ...items.filter((item) => item.status === "open" && matchesFilter(item)),
      ...items.filter((item) => item.status === "done" && matchesFilter(item)),
    ];
  }, [items, statusFilter]);
  const filteredItemCount = pagedItems.length;
  const currentItem = pagedItems[currentPage] ?? null;

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(0, pagedItems.length - 1)));
  }, [pagedItems.length]);

  useEffect(() => {
    if (!selectedRequirementId) return;
    const selectedIndex = pagedItems.findIndex((item) => item.id === selectedRequirementId);
    if (selectedIndex >= 0) setCurrentPage(selectedIndex);
  }, [pagedItems, selectedRequirementId]);
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
              popupClassName="app-workspace-requirements-status-dropdown"
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
            <Dropdown
              trigger={["click"]}
              menu={{
                className: "app-workspace-requirements-more-menu",
                items: [
                  {
                    key: "reset-all",
                    icon: <UndoOutlined />,
                    label: "全部退回初始态",
                    disabled: items.length === 0,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "reset-all") resetAllRequirements();
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label="更多需求管理操作"
                title="更多操作"
              />
            </Dropdown>
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
              <>
                <nav className="app-workspace-requirements-panel__pager" aria-label="需求翻页">
                  <span className="app-workspace-requirements-panel__pager-status">
                    {currentItem?.status === "done" ? (
                      <Tag color="success" className="app-workspace-requirements-panel__tag">已完成</Tag>
                    ) : currentItem?.status === "verifying" ? (
                      <Tag color="warning" className="app-workspace-requirements-panel__tag">待验证</Tag>
                    ) : currentItem?.lastDispatchedAt != null ? (
                      <Tag className="app-workspace-requirements-panel__tag">已派发</Tag>
                    ) : (
                      <Tag className="app-workspace-requirements-panel__tag">待办</Tag>
                    )}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={currentPage === 0}
                    onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
                    aria-label="上一个需求"
                    title="上一个需求"
                  />
                  <span className="app-workspace-requirements-panel__page-indicator">
                    {currentPage + 1} / {filteredItemCount}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<RightOutlined />}
                    disabled={currentPage >= filteredItemCount - 1}
                    onClick={() =>
                      setCurrentPage((page) => Math.min(filteredItemCount - 1, page + 1))
                    }
                    aria-label="下一个需求"
                    title="下一个需求"
                  />
                </nav>
                <ul className="app-workspace-requirements-panel__list">
                  {currentItem ? (
                    <RequirementRow
                      key={currentItem.id}
                      item={currentItem}
                      dispatchingId={dispatchingId}
                      onToggleDone={(row) => void handleToggleDone(row)}
                      onEdit={openEdit}
                      onReset={resetRequirement}
                      onDelete={handleDelete}
                      onDispatch={(row) => void handleDispatch(row)}
                      onReject={handleReject}
                    />
        ) : null}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <Modal
        title="验收失败，填写反馈"
        open={Boolean(rejectingItem)}
        cancelText="取消"
        footer={null}
        onCancel={() => setRejectingItem(null)}
      >
        <MonitorDrawerSessionComposer
          session={null}
          resumeContext={{ sessionId: rejectingItem?.executionSessionIds[rejectingItem.executionSessionIds.length - 1] }}
          onResumeSession={async ({ sessionId, prompt }) => {
            // 发送动作由会话运行时异步接管，先关闭反馈弹窗，避免弹窗阻塞中栏输入与执行状态刷新。
            setRejectingItem(null);
            const accepted = await resumeWorkspaceRequirementExecutionSession(sessionId, prompt);
            if (accepted) message.success("已发送验收反馈，正在继续执行");
            return accepted;
          }}
        />
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
