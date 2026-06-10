import {
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  CommentOutlined,
  ExperimentOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FundProjectionScreenOutlined,
  RocketOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import { memo, useMemo, useState, type ReactNode } from "react";
import {
  partitionSessionQuickActions,
  SESSION_QUICK_ACTION_META,
  type SessionQuickActionId,
  type SessionQuickActionsAvailability,
} from "../../constants/sessionQuickActionsLayout";
import { isSessionQuickBuiltinAssistantId } from "../../constants/sessionQuickBuiltinAssistants";
import { useSessionQuickActionsLayout } from "../../hooks/useSessionQuickActionsLayout";
import { SessionQuickActionsCustomizeModal } from "./SessionQuickActionsCustomizeModal";
import { prefetchNewSessionSurface } from "./prefetchNewSessionSurface";

export interface SessionQuickActionsBarProps {
  onCreateNewSession?: () => void;
  /** 新建主会话进行中：禁用按钮并显示加载态，避免重复点击 */
  creatingNewSession?: boolean;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onOpenWorkTrajectory: () => void;
  onOpenWorktreeMenu?: () => void;
  showWorktreeInMore?: boolean;
  /** 进入 Author 域「助手模板」管理页 */
  onOpenAssistantsHub?: () => void;
  /** 推送按钮（含 Popover 等交互，由父组件组装） */
  pushControl: ReactNode;
  /** 常用语 chip，展示在快捷条主行（推送与「更多」之间） */
  commonPhrasesSlot?: ReactNode;
}

const ACTION_MENU_ICONS: Partial<Record<SessionQuickActionId, ReactNode>> = {
  "new-session": <CommentOutlined />,
  "builtin:prd-split": <FileTextOutlined />,
  "builtin:word-doc": <FileWordOutlined />,
  "builtin:ppt-deck": <FundProjectionScreenOutlined />,
  "builtin:excel-data": <FileExcelOutlined />,
  "builtin:code-review": <AuditOutlined />,
  "builtin:tech-docs": <BookOutlined />,
  "builtin:test-gen": <ExperimentOutlined />,
  "builtin:release-notes": <RocketOutlined />,
  "work-trajectory": <UnorderedListOutlined />,
  "work-tree": <AppstoreOutlined />,
};

function isBuiltinAssistantQuickAction(id: SessionQuickActionId): boolean {
  return isSessionQuickBuiltinAssistantId(id);
}

export const SessionQuickActionsBar = memo(function SessionQuickActionsBar({
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onOpenWorkTrajectory,
  onOpenWorktreeMenu,
  showWorktreeInMore = false,
  onOpenAssistantsHub,
  pushControl,
  commonPhrasesSlot = null,
}: SessionQuickActionsBarProps) {
  const { layout, setLayout, resetLayout, persistLayout } = useSessionQuickActionsLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const availability: SessionQuickActionsAvailability = useMemo(
    () => ({
      canNewSession: Boolean(onCreateNewSession),
      canWorkTree: showWorktreeInMore && Boolean(onOpenWorktreeMenu),
      canCompactContext: false,
    }),
    [onCreateNewSession, onOpenWorktreeMenu, showWorktreeInMore],
  );

  const { primary, overflow } = useMemo(
    () => partitionSessionQuickActions(layout, availability),
    [layout, availability],
  );

  const renderPill = (id: SessionQuickActionId): ReactNode => {
    const meta = SESSION_QUICK_ACTION_META[id];
    if (id === "new-session") {
      return (
        <button
          key={id}
          type="button"
          className={`app-session-quick-pill${creatingNewSession ? " app-session-quick-pill--loading" : ""}`}
          disabled={creatingNewSession}
          aria-busy={creatingNewSession}
          onMouseEnter={prefetchNewSessionSurface}
          onFocus={prefetchNewSessionSurface}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (creatingNewSession) return;
            prefetchNewSessionSurface();
            onCreateNewSession?.();
          }}
        >
          <span className="app-session-quick-pill__icon app-session-quick-pill__icon--blue" aria-hidden>
            <CommentOutlined />
          </span>
          <span className="app-session-quick-pill__label">
            {creatingNewSession ? "创建中..." : meta.pillLabel}
          </span>
        </button>
      );
    }
    if (id === "push") {
      return (
        <div key={id} className="app-session-quick-pill-slot">
          {pushControl}
        </div>
      );
    }
    if (isBuiltinAssistantQuickAction(id)) {
      const iconTone = id === "builtin:prd-split" ? "orange" : "neutral";
      return (
        <button
          key={id}
          type="button"
          className="app-session-quick-pill"
          onClick={() => onOpenBuiltinAssistant?.(id)}
        >
          <span
            className={`app-session-quick-pill__icon app-session-quick-pill__icon--${iconTone}`}
            aria-hidden
          >
            {ACTION_MENU_ICONS[id] ?? <CommentOutlined />}
          </span>
          <span className="app-session-quick-pill__label">{meta.pillLabel}</span>
        </button>
      );
    }
    if (id === "work-trajectory") {
      return (
        <button key={id} type="button" className="app-session-quick-pill" onClick={onOpenWorkTrajectory}>
          <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
            <UnorderedListOutlined />
          </span>
          <span className="app-session-quick-pill__label">{meta.pillLabel}</span>
        </button>
      );
    }
    if (id === "work-tree") {
      return (
        <button key={id} type="button" className="app-session-quick-pill" onClick={() => onOpenWorktreeMenu?.()}>
          <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
            <AppstoreOutlined />
          </span>
          <span className="app-session-quick-pill__label">{meta.pillLabel}</span>
        </button>
      );
    }
    return null;
  };

  const overflowMenuItems: MenuProps["items"] = useMemo(() => {
    const items: MenuProps["items"] = overflow.map((id) => {
      const meta = SESSION_QUICK_ACTION_META[id];
      if (isBuiltinAssistantQuickAction(id)) {
        return {
          key: id,
          label: meta.label,
          icon: ACTION_MENU_ICONS[id] ?? <CommentOutlined />,
          onClick: () => onOpenBuiltinAssistant?.(id),
        };
      }
      if (id === "work-trajectory") {
        return {
          key: id,
          label: meta.label,
          icon: ACTION_MENU_ICONS[id],
          onClick: onOpenWorkTrajectory,
        };
      }
      if (id === "work-tree") {
        return {
          key: id,
          label: meta.label,
          icon: ACTION_MENU_ICONS[id],
          onClick: () => onOpenWorktreeMenu?.(),
        };
      }
      if (id === "new-session") {
        return {
          key: id,
          label: creatingNewSession ? "创建中..." : meta.label,
          icon: ACTION_MENU_ICONS[id],
          disabled: creatingNewSession,
          onClick: () => {
            if (creatingNewSession) return;
            onCreateNewSession?.();
          },
        };
      }
      if (id === "push") {
        return {
          key: id,
          label: meta.label,
          disabled: true,
          title: "推送请使用外显按钮（含 diff 统计）",
        };
      }
      return { key: id, label: meta.label };
    });

    items.push({ type: "divider" });
    items.push({
      key: "__customize",
      label: "自定义快捷操作",
      icon: <SettingOutlined />,
      onClick: () => setCustomizeOpen(true),
    });
    if (onOpenAssistantsHub) {
      items.push({
        key: "__assistants-hub",
        label: "助手模板",
        icon: <UserOutlined />,
        onClick: onOpenAssistantsHub,
      });
    }
    return items;
  }, [
    overflow,
    creatingNewSession,
    onCreateNewSession,
    onOpenBuiltinAssistant,
    onOpenWorkTrajectory,
    onOpenWorktreeMenu,
    onOpenAssistantsHub,
  ]);

  return (
    <>
      <div className="app-session-quick-actions app-session-quick-actions--dingtalk">
        <div className="app-session-quick-actions__row" role="toolbar" aria-label="会话快捷操作">
          <div className="app-session-quick-actions__primary">
            {primary.map((id) => renderPill(id))}
            {commonPhrasesSlot}
          </div>

          <div className="app-session-quick-actions__more">
            <Dropdown
              menu={{ items: overflowMenuItems, className: "app-session-quick-more-menu-inner" }}
              trigger={["click"]}
              placement="topRight"
              classNames={{ root: "app-session-quick-more-dropdown" }}
            >
              <button
                type="button"
                className="app-session-quick-pill app-session-quick-pill--more"
                aria-haspopup="menu"
                aria-label="更多快捷操作"
              >
                <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
                  <AppstoreOutlined />
                </span>
                <span className="app-session-quick-pill__label">更多</span>
              </button>
            </Dropdown>
          </div>
        </div>
      </div>

      <SessionQuickActionsCustomizeModal
        open={customizeOpen}
        onClose={() => {
          void persistLayout().then((ok) => {
            if (ok) setCustomizeOpen(false);
          });
        }}
        layout={layout}
        onLayoutChange={setLayout}
        onReset={resetLayout}
        availability={availability}
      />
    </>
  );
});
