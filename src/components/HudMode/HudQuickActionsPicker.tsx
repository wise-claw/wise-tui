import {
  ApartmentOutlined,
  CodeOutlined,
  CommentOutlined,
  LinkOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Popover } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import {
  partitionSessionQuickActions,
  type SessionQuickActionId,
  type SessionQuickActionsAvailability,
} from "../../constants/sessionQuickActionsLayout";
import {
  filterComposerCommonPhrasesForQuickBar,
  type ComposerCommonPhrase,
} from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { useHudOverlaySelectOpen } from "../../hooks/useHudOverlaySelectOpen";
import { usePointerClickAction } from "../../hooks/usePointerClickAction";
import { useSessionQuickActionsLayout } from "../../hooks/useSessionQuickActionsLayout";
import { wiseHudActivateAssistant, wiseHudNewSession } from "../../services/wiseHud";
import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantEntryKind } from "../../utils/assistantTemplateEntry";
import {
  hudSelectPopupContainer,
  isInsideHudQuickActionsPicker,
} from "../../utils/hudSelectPopup";
import {
  isAssistantTemplateQuickActionId,
  resolveSessionQuickActionMeta,
} from "../../utils/sessionQuickAssistantCatalog";
import type { WiseHudSessionSnapshot } from "../../utils/wiseHudSnapshot";
import "../ClaudeChatInput/ComposerCommonPhrasesBar.css";

export interface HudQuickActionsPickerProps {
  snapshot: WiseHudSessionSnapshot;
  onOverlayWantedChange?: (wanted: boolean) => void;
}

function IconHudQuickActions() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 3 5 14h6.5l-1 7 8-11h-6.5l1-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  if (id === "new-session") return <CommentOutlined />;
  return <UserOutlined />;
}

const HudNewSessionQuickPill = memo(function HudNewSessionQuickPill({
  pillLabel,
  onActivate,
}: {
  pillLabel: string;
  onActivate: () => void;
}) {
  const click = usePointerClickAction(onActivate);
  return (
    <button
      type="button"
      className="app-session-quick-pill app-session-quick-pill--new-session"
      onPointerDown={click.onPointerDown}
      onClick={click.onClick}
    >
      <span className="app-session-quick-pill__icon app-session-quick-pill__icon--blue" aria-hidden>
        <CommentOutlined />
      </span>
      <span className="app-session-quick-pill__label">{pillLabel}</span>
    </button>
  );
});

const HudQuickActionPill = memo(function HudQuickActionPill({
  id,
  pillLabel,
  assistant,
  onActivate,
}: {
  id: SessionQuickActionId;
  pillLabel: string;
  assistant: AssistantEntry | undefined;
  onActivate: (id: SessionQuickActionId) => void;
}) {
  const activate = useCallback(() => onActivate(id), [id, onActivate]);
  const click = usePointerClickAction(activate);
  return (
    <button
      type="button"
      className="app-session-quick-pill"
      onPointerDown={click.onPointerDown}
      onClick={click.onClick}
    >
      <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
        {actionMenuIcon(id, assistant)}
      </span>
      <span className="app-session-quick-pill__label">{pillLabel}</span>
    </button>
  );
});

export function HudQuickActionsPicker({ snapshot, onOverlayWantedChange }: HudQuickActionsPickerProps) {
  const hudSelect = useHudOverlaySelectOpen(true);
  const pointerDownTargetRef = useRef<EventTarget | null>(null);
  const { layout, catalog, assistantsById } = useSessionQuickActionsLayout();
  const { phrases: composerCommonPhrases } = useComposerCommonPhrases({
    repositoryId: snapshot.activeRepositoryId,
  });

  const quickBarPhrases = useMemo(
    () => filterComposerCommonPhrasesForQuickBar(composerCommonPhrases),
    [composerCommonPhrases],
  );

  const sessionBusyWithoutEnqueue = snapshot.busy && !snapshot.canSend;
  const phrasesDisabled = !snapshot.sessionId?.trim();

  const availability: SessionQuickActionsAvailability = useMemo(
    () => ({
      canNewSession: snapshot.activeRepositoryId != null,
      canCompactContext: false,
    }),
    [snapshot.activeRepositoryId],
  );

  const actionIds = useMemo(() => {
    const { primary, overflow } = partitionSessionQuickActions(layout, availability, catalog);
    const ids = [...primary, ...overflow];
    return ids.filter(
      (id) => id === "new-session" || isAssistantTemplateQuickActionId(id),
    );
  }, [layout, availability, catalog]);

  useEffect(() => {
    onOverlayWantedChange?.(hudSelect.overlayWanted);
  }, [hudSelect.overlayWanted, onOverlayWantedChange]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      pointerDownTargetRef.current = event.target;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const close = useCallback(() => {
    hudSelect.onOpenChange(false);
  }, [hudSelect]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        hudSelect.onOpenChange(true);
        return;
      }
      if (isInsideHudQuickActionsPicker(pointerDownTargetRef.current)) {
        return;
      }
      hudSelect.onOpenChange(false);
    },
    [hudSelect],
  );

  const handleAnchorMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // 在 click 之前撑高 HUD 并启动打开计时，避免窗口 resize 吞掉 Popover 的 click trigger。
      if (!hudSelect.open) {
        hudSelect.onOpenChange(true);
      } else {
        hudSelect.prepareOverlay();
      }
    },
    [hudSelect],
  );

  const activateAction = useCallback(
    (id: SessionQuickActionId) => {
      if (id === "new-session") {
        void wiseHudNewSession();
        close();
        return;
      }
      if (isAssistantTemplateQuickActionId(id)) {
        void wiseHudActivateAssistant(id);
        close();
      }
    },
    [close],
  );

  const applyCommonPhrase = useCallback(
    (phrase: ComposerCommonPhrase) => {
      const sessionId = snapshot.sessionId?.trim();
      if (!sessionId) return;
      dispatchApplyComposerCommonPhrase(sessionId, phrase);
      close();
    },
    [close, snapshot.sessionId],
  );

  const hasActions = actionIds.length > 0;
  const hasPhrases = quickBarPhrases.length > 0;

  const panel = (
    <div
      className="app-hud-quick-actions-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {!hasActions && !hasPhrases ? (
        <div className="app-hud-quick-actions-panel__empty">暂无快捷操作</div>
      ) : (
        <>
          {hasActions ? (
            <>
              <div className="app-hud-quick-actions-panel__title">快捷操作</div>
              <div className="app-hud-quick-actions-panel__grid" role="toolbar" aria-label="快捷操作">
                {actionIds.map((id) => {
                  const meta = resolveSessionQuickActionMeta(id, catalog);
                  if (id === "new-session") {
                    return (
                      <HudNewSessionQuickPill
                        key={id}
                        pillLabel={meta.pillLabel}
                        onActivate={() => activateAction(id)}
                      />
                    );
                  }
                  return (
                    <HudQuickActionPill
                      key={id}
                      id={id}
                      pillLabel={meta.pillLabel}
                      assistant={assistantsById.get(id)}
                      onActivate={activateAction}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
          {hasPhrases ? (
            <>
              <div
                className={`app-hud-quick-actions-panel__title${hasActions ? " app-hud-quick-actions-panel__title--section" : ""}`}
              >
                常用语
              </div>
              <ComposerCommonPhrasesBar
                variant="quickBar"
                phrases={quickBarPhrases}
                disabled={phrasesDisabled}
                sessionBusyWithoutEnqueue={sessionBusyWithoutEnqueue}
                onApplyPhrase={applyCommonPhrase}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="app-hud-quick-actions-anchor" onMouseDown={handleAnchorMouseDown}>
      <Popover
        trigger="click"
        placement="topLeft"
        arrow={false}
        autoAdjustOverflow={false}
        open={hudSelect.open}
        onOpenChange={handleOpenChange}
        getPopupContainer={hudSelectPopupContainer}
        destroyOnHidden={false}
        classNames={{ root: "app-hud-quick-actions-popover" }}
        styles={{
          container: { padding: 0 },
          content: { padding: 0 },
        }}
        content={panel}
      >
        <button
          type="button"
          className={`app-hud-quick-actions-btn${hudSelect.open ? " app-hud-quick-actions-btn--open" : ""}`}
          aria-expanded={hudSelect.open}
          aria-label="快捷操作"
          title="快捷操作"
        >
          <IconHudQuickActions />
        </button>
      </Popover>
    </div>
  );
}
