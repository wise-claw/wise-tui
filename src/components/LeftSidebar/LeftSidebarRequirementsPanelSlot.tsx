import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  SendOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { convertFileSrc } from "@tauri-apps/api/core";
import { App as AntdApp, Button, Image, Popconfirm, Popover, Switch } from "antd";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { dispatchRequirementToExecutionEnvironment } from "../../constants/pendingTaskQueueEvents";
import { useWorkspaceRequirementAutoDispatchSetting } from "../../hooks/useWorkspaceRequirementAutoDispatch";
import {
  REQUIREMENTS_PANEL_HEAD_HEIGHT_PX,
  REQUIREMENTS_PANEL_ROW_HEIGHT_PX,
} from "../../constants/requirementsPanelLayout";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { useRequirementsPanelVisibleRows } from "../../hooks/useRequirementsPanelVisibleRows";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import {
  buildRequirementDispatchPayload,
  countMarkdownImages,
  stripMarkdownImages,
} from "../../services/workspaceRequirementDispatch";
import {
  loadWorkspaceRequirements,
  saveWorkspaceRequirements,
  updateWorkspaceRequirement,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
} from "../../services/workspaceRequirementsStore";
import {
  openWorkspaceMemoPanel,
  requestWorkspaceRequirementCreate,
  requestWorkspaceRequirementEdit,
  toggleWorkspaceMemoPanel,
  useWorkspaceMemoPanelOpen,
} from "../../stores/workspaceMemoPanelStore";
import type { Repository } from "../../types";
import type {
  WorkspaceRequirementItem,
  WorkspaceRequirementsPayloadV1,
} from "../../types/workspaceRequirements";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { MarkdownBody } from "../ClaudeSessions/MarkdownElements";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { ExpandIcon, PlusIcon, WorkspaceMemoIcon } from "./SidebarIcons";
import { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import "./LeftSidebarRequirementsPanelSlot.css";

export type LeftSidebarRequirementsPanelSlotProps = {
  visible?: boolean;
  sectionCollapsed: boolean;
  onSectionCollapsedChange: (collapsed: boolean) => void;
  repositories: Repository[];
  activeRepositoryId: number | null;
};

function resolveRepoMeta(
  repositories: Repository[],
  repositoryId: string | null,
): { label: string; missing: boolean } {
  if (!repositoryId) {
    return { label: "未指定仓库", missing: true };
  }
  const repo = repositories.find((item) => String(item.id) === repositoryId);
  if (!repo) {
    return { label: "未知仓库", missing: true };
  }
  return { label: repositoryFolderBasename(repo), missing: false };
}

function stopRowAction(event: ReactMouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function markdownImageSrc(src: string): string {
  if (!src || !src.startsWith("/")) return src;
  try {
    return convertFileSrc(src);
  } catch {
    return src;
  }
}

/** 把正文内 `![...](/abs路径)` 与 `<img src="/abs路径">` 转为可加载的 asset URL。 */
function hydrateMarkdownImageSrcs(markdown: string): string {
  let next = markdown;
  next = next.replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, (_match, alt, path) => {
    return `![${String(alt ?? "")}](${markdownImageSrc(String(path ?? ""))})`;
  });
  next = next.replace(
    /(<img\b[^>]*?\bsrc=")(\/[^"]+)(")/gi,
    (_match, prefix, path, suffix) =>
      `${String(prefix)}${markdownImageSrc(String(path ?? ""))}${String(suffix)}`,
  );
  return next;
}

const popoverMarkdownComponents: Components = {
  img: ({ node: _node, src, alt }) => (
    <Image
      src={src}
      alt={alt ?? ""}
      className="app-left-sidebar-requirements-panel__popover-md-img"
      preview={{ mask: "预览" }}
    />
  ),
};

/** 放行 Tauri asset / data URL 图片 src；其余 URL 沿用 react-markdown 默认规则。 */
const allowTauriAssetUrlTransform: UrlTransform = (url) => {
  if (url.startsWith("asset:") || /^https?:\/\/asset\./i.test(url) || url.startsWith("data:")) return url;
  return defaultUrlTransform(url);
};

function RequirementsPanelRow({
  item,
  repoLabel,
  repoMissing,
  dispatching,
  onOpenPanel,
  onDispatch,
  onEdit,
  onDelete,
  onVerifyDone,
}: {
  item: WorkspaceRequirementItem;
  repoLabel: string;
  repoMissing: boolean;
  dispatching: boolean;
  onOpenPanel: () => void;
  onDispatch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onVerifyDone: () => void;
}) {
  const done = item.status === "done";
  const verifying = item.status === "verifying";
  const dispatched = item.lastDispatchedAt != null;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rawBody = item.bodyMarkdown || item.description || "";
  const bodyText = stripMarkdownImages(rawBody);
  const bodyFlat = bodyText.replace(/\s+/g, " ").trim();
  const hasBodyImages = countMarkdownImages(rawBody) > 0;
  const desc =
    rawBody.trim() && (bodyFlat !== item.title || hasBodyImages) ? rawBody : "";
  const mdSource = desc ? hydrateMarkdownImageSrcs(desc) : "";

  const popoverContent = (
    <div className="app-left-sidebar-requirements-panel__popover">
      <div className="app-left-sidebar-requirements-panel__popover-head">
        <span className="app-left-sidebar-requirements-panel__popover-title">{item.title}</span>
        {verifying ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--verifying"
            title="会话执行完成，等待验证"
          >
            待验证
          </span>
        ) : dispatched && !done ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--dispatched"
            title="已派发到执行环境"
          >
            已派发
          </span>
        ) : done ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--verified"
            title="验证完成"
          >
            已验证
          </span>
        ) : null}
      </div>
      {!repoMissing ? (
        <div className="app-left-sidebar-requirements-panel__popover-repo">{repoLabel}</div>
      ) : null}
      {desc ? (
        <Image.PreviewGroup>
          <div className="app-left-sidebar-requirements-panel__popover-md app-markdown">
            <MarkdownBody
              source={mdSource}
              rehypePlugins={[rehypeRaw]}
              components={popoverMarkdownComponents}
              urlTransform={allowTauriAssetUrlTransform}
            />
          </div>
        </Image.PreviewGroup>
      ) : null}
      <div className="app-left-sidebar-requirements-panel__popover-actions">
        {verifying ? (
          <Button
            type="primary"
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => {
              setPopoverOpen(false);
              onVerifyDone();
            }}
          >
            验证完成
          </Button>
        ) : null}
        <Button
          type="text"
          size="small"
          onClick={() => {
            setPopoverOpen(false);
            onOpenPanel();
          }}
        >
          打开面板
        </Button>
        <Button
          type="text"
          size="small"
          onClick={() => {
            setPopoverOpen(false);
            onEdit();
          }}
        >
          编辑
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="rightTop"
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      content={popoverContent}
      overlayClassName="app-left-sidebar-requirements-panel__popover-overlay"
    >
      <div
        className={
          "app-left-sidebar-requirements-panel__row" +
          (done ? " app-left-sidebar-requirements-panel__row--done" : "")
        }
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setPopoverOpen((prev) => !prev);
          }
        }}
        title={item.title}
      >
        {repoMissing ? (
          <DeferredHoverTooltip title={repoLabel}>
            <button
              type="button"
              className="app-left-sidebar-requirements-panel__row-repo-missing"
              aria-label={repoLabel}
              onClick={stopRowAction}
            >
              <WarningOutlined />
            </button>
          </DeferredHoverTooltip>
        ) : null}
        {verifying ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--verifying"
            title="会话执行完成，等待验证"
          >
            待验证
          </span>
        ) : dispatched && !done ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--dispatched"
            title="已派发到执行环境"
          >
            已派发
          </span>
        ) : done ? (
          <span
            className="app-left-sidebar-requirements-panel__row-badge app-left-sidebar-requirements-panel__row-badge--verified"
            title="验证完成"
          >
            已验证
          </span>
        ) : null}
        <span className="app-left-sidebar-requirements-panel__row-title">{item.title}</span>
        {!repoMissing ? (
          <span className="app-left-sidebar-requirements-panel__row-repo" title={repoLabel}>
            {repoLabel}
          </span>
        ) : null}
        <div
          className="app-left-sidebar-requirements-panel__row-actions"
          onClick={stopRowAction}
        >
          {!done ? (
            <DeferredHoverTooltip title="派发到当前执行环境（不占主会话）">
              <button
                type="button"
                className={
                  "app-left-sidebar-requirements-panel__action-btn" +
                  (dispatching ? " app-left-sidebar-requirements-panel__action-btn--loading" : "")
                }
                aria-label="派发执行"
                disabled={dispatching}
                onClick={onDispatch}
              >
                {dispatching ? <LoadingOutlined spin /> : <SendOutlined />}
              </button>
            </DeferredHoverTooltip>
          ) : null}
          <DeferredHoverTooltip title="编辑">
            <button
              type="button"
              className="app-left-sidebar-requirements-panel__action-btn"
              aria-label="编辑需求"
              onClick={onEdit}
            >
              <EditOutlined />
            </button>
          </DeferredHoverTooltip>
          <Popconfirm
            title="删除该需求？"
            description={item.title}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, size: "small" }}
            cancelButtonProps={{ size: "small" }}
            placement="bottomLeft"
            getPopupContainer={() => document.body}
            onConfirm={onDelete}
          >
            <button
              type="button"
              className="app-left-sidebar-requirements-panel__action-btn app-left-sidebar-requirements-panel__action-btn--danger"
              aria-label="删除需求"
              title="删除"
            >
              <DeleteOutlined />
            </button>
          </Popconfirm>
        </div>
      </div>
    </Popover>
  );
}

function LeftSidebarRequirementsPanelSlotInner({
  visible = true,
  sectionCollapsed,
  onSectionCollapsedChange,
  repositories,
  activeRepositoryId,
}: LeftSidebarRequirementsPanelSlotProps) {
  const { message } = AntdApp.useApp();
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const visibleRows = useRequirementsPanelVisibleRows();
  const memoPanelOpen = useWorkspaceMemoPanelOpen();
  const { enabled: autoDispatch, setEnabled: setAutoDispatch, concurrency: autoDispatchConcurrency } =
    useWorkspaceRequirementAutoDispatchSetting();
  const [items, setItems] = useState<WorkspaceRequirementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mountedRef = useRef(true);

  useScrollEndClass(scrollRootRef, LEFT_SIDEBAR_SCROLLING_CLASS, 220, {
    relieveSidePanelPriority: true,
    rebindKey: sectionCollapsed,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void loadWorkspaceRequirements()
      .then((payload) => {
        if (cancelled) return;
        setItems(payload.items);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[LeftSidebarRequirements] load failed", err);
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<WorkspaceRequirementsPayloadV1>).detail;
      if (!detail || !Array.isArray(detail.items)) return;
      setItems(detail.items);
    }
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onChanged);
    return () => {
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onChanged);
    };
  }, []);

  const persist = useCallback(async (next: WorkspaceRequirementItem[]) => {
    const saved = await saveWorkspaceRequirements(next);
    if (mountedRef.current) {
      setItems(saved.items);
    }
  }, []);

  const openItems = useMemo(
    () => items.filter((item) => item.status === "open"),
    [items],
  );
  const verifyingItems = useMemo(
    () => items.filter((item) => item.status === "verifying"),
    [items],
  );
  const doneItems = useMemo(
    () => items.filter((item) => item.status === "done"),
    [items],
  );
  const displayItems = useMemo(
    () => [...verifyingItems, ...openItems, ...doneItems],
    [openItems, verifyingItems, doneItems],
  );

  const handleCreate = useCallback(() => {
    requestWorkspaceRequirementCreate({
      defaultRepositoryId:
        activeRepositoryId != null ? String(activeRepositoryId) : null,
    });
  }, [activeRepositoryId]);

  const handleOpenFull = useCallback(() => {
    openWorkspaceMemoPanel();
  }, []);

  const handleVerifyDone = useCallback(
    async (item: WorkspaceRequirementItem) => {
      try {
        await updateWorkspaceRequirement(item.id, (row) =>
          row.status === "done"
            ? row
            : { ...row, status: "done", updatedAt: Date.now() },
        );
      } catch (err) {
        console.error("[LeftSidebarRequirements] verify done failed", err);
        message.error(err instanceof Error ? err.message : "验证完成失败");
      }
    },
    [message],
  );

  const handleEdit = useCallback((item: WorkspaceRequirementItem) => {
    requestWorkspaceRequirementEdit(item.id);
  }, []);

  const handleDelete = useCallback(
    async (item: WorkspaceRequirementItem) => {
      try {
        await persist(itemsRef.current.filter((row) => row.id !== item.id));
      } catch (err) {
        console.error("[LeftSidebarRequirements] delete failed", err);
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [message, persist],
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
        });
        if (!accepted) {
          message.warning("当前没有可用主会话，无法派发到执行环境");
          return;
        }
        const now = Date.now();
        await persist(
          itemsRef.current.map((row) =>
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
          ),
        );
      } catch (err) {
        console.error("[LeftSidebarRequirements] dispatch failed", err);
        message.error(err instanceof Error ? err.message : "派发失败");
      } finally {
        if (mountedRef.current) setDispatchingId(null);
      }
    },
    [message, persist],
  );

  if (!visible) {
    return null;
  }

  return (
    <div
      className={
        "app-left-sidebar-requirements-panel" +
        (sectionCollapsed ? " app-left-sidebar-requirements-panel--section-collapsed" : "")
      }
      style={
        {
          "--requirements-panel-row-height": `${REQUIREMENTS_PANEL_ROW_HEIGHT_PX}px`,
          "--requirements-panel-head-height": `${REQUIREMENTS_PANEL_HEAD_HEIGHT_PX}px`,
          "--requirements-panel-max-visible-rows": visibleRows,
        } as CSSProperties
      }
      aria-label="需求列表"
    >
      <div
        className="app-repository-header app-left-sidebar-requirements-panel__head"
        onClick={() => onSectionCollapsedChange(!sectionCollapsed)}
        style={{ cursor: "pointer" }}
      >
        <span className="app-repository-header-title">
         需求
          {!loading && openItems.length + verifyingItems.length > 0 ? (
            <span className="app-left-sidebar-requirements-panel__count">
              {openItems.length + verifyingItems.length}
            </span>
          ) : null}
        </span>
        <div
          className="app-repository-header-actions"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <DeferredHoverTooltip
            title={
              autoDispatch
                ? `自动派发已开启：新增/编辑的待办需求会自动派发到当前执行环境；并发上限 ${autoDispatchConcurrency}（按当前运行会话数动态派发）`
                : "开启后新增/编辑的待办需求会自动派发到当前执行环境"
            }
          >
            <span className="app-left-sidebar-requirements-panel__auto-dispatch">
              <Switch
                size="small"
                checked={autoDispatch}
                onChange={(checked) => void setAutoDispatch(checked)}
                aria-label="自动派发"
              />
            </span>
          </DeferredHoverTooltip>
          <DeferredHoverTooltip title="打开需求管理">
            <button
              type="button"
              className={`app-repository-header-btn${memoPanelOpen ? " app-repository-header-btn--active" : ""}`}
              aria-label="打开需求管理"
              aria-pressed={memoPanelOpen}
              onClick={() => toggleWorkspaceMemoPanel()}
            >
              <WorkspaceMemoIcon />
            </button>
          </DeferredHoverTooltip>
          <DeferredHoverTooltip title="新增需求">
            <button
              type="button"
              className="app-repository-header-btn"
              aria-label="新增需求"
              onClick={handleCreate}
            >
              <PlusIcon />
            </button>
          </DeferredHoverTooltip>
          <DeferredHoverTooltip title={sectionCollapsed ? "展开需求列表" : "收起需求列表"}>
            <button
              type="button"
              className="app-repository-header-btn"
              aria-expanded={!sectionCollapsed}
              aria-label={sectionCollapsed ? "展开需求列表" : "收起需求列表"}
              onClick={() => onSectionCollapsedChange(!sectionCollapsed)}
            >
              <ExpandIcon expanded={!sectionCollapsed} />
            </button>
          </DeferredHoverTooltip>
        </div>
      </div>

      {!sectionCollapsed ? (
        <div ref={scrollRootRef} className="app-left-sidebar-requirements-panel__body">
          {loading ? (
            <div className="app-left-sidebar-requirements-panel__empty">加载中…</div>
          ) : displayItems.length === 0 ? (
            <div className="app-left-sidebar-requirements-panel__empty app-left-sidebar-requirements-panel__empty--with-action">
              <span className="app-left-sidebar-requirements-panel__empty-text">
                暂无需求
              </span>
              <button
                type="button"
                className="app-left-sidebar-requirements-panel__empty-add-btn"
                onClick={handleCreate}
              >
                新增
              </button>
            </div>
          ) : (
            <ul className="app-left-sidebar-requirements-panel__list">
              {displayItems.map((item) => {
                const repo = resolveRepoMeta(repositories, item.repositoryId);
                return (
                  <li key={item.id}>
                    <RequirementsPanelRow
                      item={item}
                      repoLabel={repo.label}
                      repoMissing={repo.missing}
                      dispatching={dispatchingId === item.id}
                      onOpenPanel={handleOpenFull}
                      onDispatch={() => void handleDispatch(item)}
                      onEdit={() => handleEdit(item)}
                      onDelete={() => void handleDelete(item)}
                      onVerifyDone={() => void handleVerifyDone(item)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function requirementsPanelPropsEqual(
  prev: LeftSidebarRequirementsPanelSlotProps,
  next: LeftSidebarRequirementsPanelSlotProps,
): boolean {
  return (
    prev.visible === next.visible &&
    prev.sectionCollapsed === next.sectionCollapsed &&
    prev.onSectionCollapsedChange === next.onSectionCollapsedChange &&
    prev.activeRepositoryId === next.activeRepositoryId &&
    prev.repositories === next.repositories
  );
}

export const LeftSidebarRequirementsPanelSlot = memo(
  LeftSidebarRequirementsPanelSlotInner,
  requirementsPanelPropsEqual,
);
