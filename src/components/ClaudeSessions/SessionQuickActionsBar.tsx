import {
  ApartmentOutlined,
  AppstoreOutlined,
  CodeOutlined,
  CommentOutlined,
  LinkOutlined,
  LoadingOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  partitionSessionQuickActions,
  type SessionQuickActionId,
  type SessionQuickActionsAvailability,
} from "../../constants/sessionQuickActionsLayout";
import { usePointerClickAction } from "../../hooks/usePointerClickAction";
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
  /** 常用语 chip，展示在快捷条主行（「更多」按钮之前） */
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
      case "dispatch_direct":
        return <ThunderboltOutlined />;
      default:
        break;
    }
  }
  return BUILTIN_ACTION_MENU_ICONS[id] ?? <UserOutlined />;
}

const AssistantQuickPill = memo(function AssistantQuickPill({
  id,
  pillLabel,
  assistant,
  onActivate,
}: {
  id: SessionQuickActionId;
  pillLabel: string;
  assistant: AssistantEntry | undefined;
  onActivate: (assistantId: string) => void;
}) {
  const activate = useCallback(() => onActivate(id), [id, onActivate]);
  const click = usePointerClickAction(activate);
  const iconTone = "neutral";
  return (
    <button
      type="button"
      className="app-session-quick-pill"
      onPointerDown={click.onPointerDown}
      onClick={click.onClick}
    >
      <span
        className={`app-session-quick-pill__icon app-session-quick-pill__icon--${iconTone}`}
        aria-hidden
      >
        {actionMenuIcon(id, assistant)}
      </span>
      <span className="app-session-quick-pill__label">{pillLabel}</span>
    </button>
  );
});

export const SessionQuickActionsBar = memo(function SessionQuickActionsBar({
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  commonPhrasesSlot = null,
  extraTrailingSlot = null,
}: SessionQuickActionsBarProps) {
  const { layout, setLayout, resetLayout, persistLayout, catalog, assistantsById } =
    useSessionQuickActionsLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);

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

  const activateAssistantById = useCallback(
    (assistantId: string) => {
      const assistant = assistantsById.get(assistantId);
      if (assistant && onActivateAssistant) {
        void onActivateAssistant(assistant);
        return;
      }
      onOpenBuiltinAssistant?.(assistantId);
    },
    [assistantsById, onActivateAssistant, onOpenBuiltinAssistant],
  );

  const invokeCreateNewSession = useCallback(() => {
    if (creatingNewSession) return;
    prefetchNewSessionSurface();
    onCreateNewSession?.();
  }, [creatingNewSession, onCreateNewSession]);

  const newSessionClick = usePointerClickAction(invokeCreateNewSession, creatingNewSession);

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
          onPointerDown={newSessionClick.onPointerDown}
          onClick={newSessionClick.onClick}
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
    if (isAssistantTemplateQuickActionId(id)) {
      return (
        <AssistantQuickPill
          key={id}
          id={id}
          pillLabel={meta.pillLabel}
          assistant={assistantsById.get(id)}
          onActivate={activateAssistantById}
        />
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
