import {
  ApartmentOutlined,
  AppstoreOutlined,
  CodeOutlined,
  CommentOutlined,
  LinkOutlined,
  LoadingOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import {
  partitionSessionQuickActions,
  type SessionQuickActionId,
  type SessionQuickActionsAvailability,
} from "../../constants/sessionQuickActionsLayout";
import { useSessionQuickActionsLayout } from "../../hooks/useSessionQuickActionsLayout";
import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantEntryKind } from "../../utils/assistantTemplateEntry";
import {
  isAssistantTemplateQuickActionId,
  resolveSessionQuickActionMeta,
} from "../../utils/sessionQuickAssistantCatalog";
import { SessionQuickActionsCustomizeModal } from "./SessionQuickActionsCustomizeModal";
import { prefetchNewSessionSurface } from "./prefetchNewSessionSurface";

export interface SessionQuickActionsBarProps {
  onCreateNewSession?: () => void;
  /** 新建主会话进行中：禁用按钮并显示加载态，避免重复点击 */
  creatingNewSession?: boolean;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  /** 按助手模板完整激活（对话 / 链接 / 工作流 / 脚本） */
  onActivateAssistant?: (assistant: AssistantEntry) => void | Promise<void>;
  /** 进入 Author 域「助手模板」管理页 */
  onOpenAssistantsHub?: () => void;
  /** 推送按钮（含 Popover 等交互，由父组件组装） */
  pushControl: ReactNode;
  /** 常用语 chip，展示在快捷条主行（推送与「更多」之间） */
  commonPhrasesSlot?: ReactNode;
  /** 主行尾部的额外 slot（位于常用语之后、「更多」按钮之前） */
  extraTrailingSlot?: ReactNode;
}

const BUILTIN_ACTION_MENU_ICONS: Partial<Record<SessionQuickActionId, ReactNode>> = {
  "new-session": <CommentOutlined />,
};

function actionMenuIcon(id: SessionQuickActionId, assistant?: AssistantEntry): ReactNode {
  if (assistant) {
    switch (resolveAssistantEntryKind(assistant)) {
      case "open_link":
        return <LinkOutlined />;
      case "run_workflow":
        return <ApartmentOutlined />;
      case "run_script":
        return <CodeOutlined />;
      default:
        break;
    }
  }
  return BUILTIN_ACTION_MENU_ICONS[id] ?? <UserOutlined />;
}

export const SessionQuickActionsBar = memo(function SessionQuickActionsBar({
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  pushControl,
  commonPhrasesSlot = null,
  extraTrailingSlot = null,
}: SessionQuickActionsBarProps) {
  const { layout, setLayout, resetLayout, persistLayout, catalog, assistantsById } =
    useSessionQuickActionsLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const createInvokeLockRef = useRef(false);

  useEffect(() => {
    prefetchNewSessionSurface();
  }, []);

  const availability: SessionQuickActionsAvailability = useMemo(
    () => ({
      canNewSession: Boolean(onCreateNewSession),
      canCompactContext: false,
    }),
    [onCreateNewSession],
  );

  const { primary, overflow } = useMemo(
    () => partitionSessionQuickActions(layout, availability, catalog),
    [layout, availability, catalog],
  );

  const activateAssistantById = (assistantId: string) => {
    const assistant = assistantsById.get(assistantId);
    if (assistant && onActivateAssistant) {
      void onActivateAssistant(assistant);
      return;
    }
    onOpenBuiltinAssistant?.(assistantId);
  };

  const invokeCreateNewSession = useCallback(() => {
    if (creatingNewSession || createInvokeLockRef.current) return;
    createInvokeLockRef.current = true;
    queueMicrotask(() => {
      createInvokeLockRef.current = false;
    });
    prefetchNewSessionSurface();
    onCreateNewSession?.();
  }, [creatingNewSession, onCreateNewSession]);

  const handleNewSessionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || creatingNewSession) return;
      event.preventDefault();
      invokeCreateNewSession();
    },
    [creatingNewSession, invokeCreateNewSession],
  );

  const handleNewSessionClick = useCallback(() => {
    invokeCreateNewSession();
  }, [invokeCreateNewSession]);

  const renderPill = (id: SessionQuickActionId): ReactNode => {
    const meta = resolveSessionQuickActionMeta(id, catalog);
    if (id === "new-session") {
      return (
        <button
          key={id}
          type="button"
          className={`app-session-quick-pill app-session-quick-pill--new-session${
            creatingNewSession ? " app-session-quick-pill--loading" : ""
          }`}
          disabled={creatingNewSession}
          aria-busy={creatingNewSession}
          aria-label={creatingNewSession ? "正在创建会话" : meta.pillLabel}
          onMouseEnter={prefetchNewSessionSurface}
          onFocus={prefetchNewSessionSurface}
          onPointerDown={handleNewSessionPointerDown}
          onClick={handleNewSessionClick}
        >
          <span className="app-session-quick-pill__icon app-session-quick-pill__icon--blue" aria-hidden>
            {creatingNewSession ? <LoadingOutlined spin /> : <CommentOutlined />}
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
    if (isAssistantTemplateQuickActionId(id)) {
      const iconTone = "neutral";
      return (
        <button
          key={id}
          type="button"
          className="app-session-quick-pill"
          onClick={() => activateAssistantById(id)}
        >
          <span
            className={`app-session-quick-pill__icon app-session-quick-pill__icon--${iconTone}`}
            aria-hidden
          >
            {actionMenuIcon(id, assistantsById.get(id))}
          </span>
          <span className="app-session-quick-pill__label">{meta.pillLabel}</span>
        </button>
      );
    }
    return null;
  };

  const overflowMenuItems: MenuProps["items"] = useMemo(() => {
    const items: MenuProps["items"] = overflow.map((id) => {
      const meta = resolveSessionQuickActionMeta(id, catalog);
      if (isAssistantTemplateQuickActionId(id)) {
        return {
          key: id,
          label: meta.label,
          icon: actionMenuIcon(id, assistantsById.get(id)),
          onClick: () => activateAssistantById(id),
        };
      }
      if (id === "new-session") {
        return {
          key: id,
          label: creatingNewSession ? "创建中..." : meta.label,
          icon: actionMenuIcon(id),
          disabled: creatingNewSession,
          onClick: () => {
            invokeCreateNewSession();
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
        label: "管理助手模板",
        icon: <UserOutlined />,
        onClick: onOpenAssistantsHub,
      });
    }
    return items;
  }, [
    overflow,
    catalog,
    creatingNewSession,
    invokeCreateNewSession,
    onOpenBuiltinAssistant,
    onActivateAssistant,
    assistantsById,
    onOpenAssistantsHub,
  ]);

  return (
    <>
      <div className="app-session-quick-actions app-session-quick-actions--dingtalk">
        <div className="app-session-quick-actions__row" role="toolbar" aria-label="会话快捷操作">
          <div className="app-session-quick-actions__primary">
            {primary.map((id) => renderPill(id))}
            {commonPhrasesSlot}
            {extraTrailingSlot}
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
        catalog={catalog}
        onLayoutChange={setLayout}
        onReset={resetLayout}
        availability={availability}
        onOpenAssistantsHub={onOpenAssistantsHub}
      />
    </>
  );
});
