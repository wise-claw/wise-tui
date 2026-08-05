import {
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  SendOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Popconfirm } from "antd";
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
import {
  REQUIREMENTS_PANEL_HEAD_HEIGHT_PX,
  REQUIREMENTS_PANEL_ROW_HEIGHT_PX,
} from "../../constants/requirementsPanelLayout";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { useRequirementsPanelVisibleRows } from "../../hooks/useRequirementsPanelVisibleRows";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { buildRequirementDispatchPayload } from "../../services/workspaceRequirementDispatch";
import {
  loadWorkspaceRequirements,
  saveWorkspaceRequirements,
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
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { ExpandIcon, PlusIcon, WorkspaceMemoIcon } from "./SidebarIcons";
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

function RequirementsPanelRow({
  item,
  repoLabel,
  repoMissing,
  dispatching,
  onOpen,
  onDispatch,
  onEdit,
  onDelete,
}: {
  item: WorkspaceRequirementItem;
  repoLabel: string;
  repoMissing: boolean;
  dispatching: boolean;
  onOpen: () => void;
  onDispatch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const done = item.status === "done";
  return (
    <div
      className={
        "app-left-sidebar-requirements-panel__row" +
        (done ? " app-left-sidebar-requirements-panel__row--done" : "")
      }
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      title={item.title}
    >
      {repoMissing ? (
        <DeferredHoverTooltip title={repoLabel}>
          <span
            className="app-left-sidebar-requirements-panel__row-repo-missing"
            aria-label={repoLabel}
            onClick={stopRowAction}
          >
            <WarningOutlined />
          </span>
        </DeferredHoverTooltip>
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
  const doneItems = useMemo(
    () => items.filter((item) => item.status === "done"),
    [items],
  );
  const displayItems = useMemo(
    () => [...openItems, ...doneItems],
    [openItems, doneItems],
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
          {!loading && openItems.length > 0 ? (
            <span className="app-left-sidebar-requirements-panel__count">{openItems.length}</span>
          ) : null}
        </span>
        <div
          className="app-repository-header-actions"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
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
                      onOpen={handleOpenFull}
                      onDispatch={() => void handleDispatch(item)}
                      onEdit={() => handleEdit(item)}
                      onDelete={() => void handleDelete(item)}
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
