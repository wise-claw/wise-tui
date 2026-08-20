import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  SendOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Input, Popconfirm, Switch, Tag } from "antd";
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
import { buildRequirementDispatchPayload } from "../../services/workspaceRequirementDispatch";
import {
  loadWorkspaceRequirements,
  saveWorkspaceRequirements,
  updateWorkspaceRequirement,
  WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
} from "../../services/workspaceRequirementsStore";
import {
  openWorkspaceMemoPanel,
  requestWorkspaceRequirementCreate,
  requestWorkspaceRequirementEdit,
  toggleWorkspaceMemoPanel,
  useWorkspaceMemoPanelOpen,
} from "../../stores/workspaceMemoPanelStore";
import {
  type WorkspaceRequirementStatus,
} from "../../constants/workspaceRequirementStatusFilter";
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

  return (
      <div
        className={
          "app-left-sidebar-requirements-panel__row" +
          (done ? " app-left-sidebar-requirements-panel__row--done" : "")
        }
        role="button"
        tabIndex={0}
        onClick={onOpenPanel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenPanel();
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
        <span
          className={
            "app-left-sidebar-requirements-panel__row-badge " +
            (verifying
              ? "app-left-sidebar-requirements-panel__row-badge--verifying"
              : done
                ? "app-left-sidebar-requirements-panel__row-badge--verified"
                : "app-left-sidebar-requirements-panel__row-badge--open")
          }
          title={verifying ? "会话执行完成，等待验证" : done ? "已完成" : "待办"}
        >
          {verifying ? "待验证" : done ? "已完成" : "待办"}
        </span>
        <span className="app-left-sidebar-requirements-panel__row-title">{item.title}</span>
        <div
          className="app-left-sidebar-requirements-panel__row-actions"
          onClick={stopRowAction}
        >
          {verifying ? (
            <DeferredHoverTooltip title="标记为验证完成">
              <button
                type="button"
                className="app-left-sidebar-requirements-panel__action-btn"
                aria-label="验证完成"
                onClick={onVerifyDone}
              >
                <CheckCircleOutlined />
              </button>
            </DeferredHoverTooltip>
          ) : null}
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
            overlayClassName="app-left-sidebar-requirements-panel__delete-popconfirm"
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
  const [statusFilters, setStatusFilters] = useState<WorkspaceRequirementStatus[]>([
    "open",
    "verifying",
    "done",
  ]);
  const {
    enabled: autoDispatch,
    setEnabled: setAutoDispatch,
    concurrency: autoDispatchConcurrency,
    setConcurrency: setAutoDispatchConcurrency,
  } = useWorkspaceRequirementAutoDispatchSetting();
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
    () => [...verifyingItems, ...openItems, ...doneItems].filter((item) =>
      statusFilters.includes(item.status),
    ),
    [openItems, verifyingItems, doneItems, statusFilters],
  );

  const handleCreate = useCallback(() => {
    requestWorkspaceRequirementCreate({
      defaultRepositoryId:
        activeRepositoryId != null ? String(activeRepositoryId) : null,
    });
  }, [activeRepositoryId]);

  const handleOpenFull = useCallback((item: WorkspaceRequirementItem) => {
    openWorkspaceMemoPanel(item.id);
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
          requirementRepositoryId: item.repositoryId,
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
              <Input
                size="small"
                value={autoDispatchConcurrency}
                inputMode="numeric"
                onChange={(value) => {
                  const raw = value.target.value.trim();
                  if (!/^\d+$/.test(raw)) return;
                  const parsed = Number(raw);
                  void setAutoDispatchConcurrency(
                    Math.max(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_MIN, parsed),
                  );
                }}
                className="app-left-sidebar-requirements-panel__auto-dispatch-concurrency"
                aria-label="自动派发并发数"
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
        <>
          <div className="app-left-sidebar-requirements-panel__filter-bar">
            <span className="app-left-sidebar-requirements-panel__filter-label">状态</span>
            <div className="app-left-sidebar-requirements-panel__status-tags" aria-label="按需求状态过滤">
              {([
                ["open", "待办"],
                ["verifying", "待验证"],
                ["done", "已完成"],
              ] as const).map(([value, label]) => {
                const checked = statusFilters.includes(value);
                return (
                  <Tag.CheckableTag
                    key={value}
                    checked={checked}
                    onChange={(nextChecked) => {
                      setStatusFilters((current) =>
                        nextChecked
                          ? [...current, value]
                          : current.filter((status) => status !== value),
                      );
                    }}
                    className="app-left-sidebar-requirements-panel__status-tag"
                  >
                    {label}
                  </Tag.CheckableTag>
                );
              })}
            </div>
          </div>
          <div ref={scrollRootRef} className="app-left-sidebar-requirements-panel__body">
          {loading ? (
            <div className="app-left-sidebar-requirements-panel__empty">加载中…</div>
          ) : displayItems.length === 0 ? (
            <div className="app-left-sidebar-requirements-panel__empty app-left-sidebar-requirements-panel__empty--with-action">
              <span className="app-left-sidebar-requirements-panel__empty-text">
                {items.length === 0 ? "暂无需求" : "当前状态暂无"}
              </span>
              <button
                type="button"
                className="app-left-sidebar-requirements-panel__empty-add-btn"
                onClick={
                  items.length === 0
                    ? handleCreate
                    : () => setStatusFilters(["open", "verifying", "done"])
                }
              >
                {items.length === 0 ? "新增" : "查看全部"}
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
                      onOpenPanel={() => handleOpenFull(item)}
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
        </>
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
